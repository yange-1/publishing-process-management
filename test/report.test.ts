import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  toShanghaiYMD,
  monthLength,
  shanghaiDayStartMs,
  monthStartMs,
  monthEndMs,
  toIso,
} from "../lib/date-util.ts";
import { buildPeriodSpec, periodMonths } from "../lib/report-period.ts";
import { movingAverage, LOW_CONFIDENCE_NOTE, NO_DATA_NOTE } from "../lib/report-forecast.ts";
import { computeReport } from "../lib/report-service.ts";
import { canAccessReport, reportCompanyScope } from "../lib/report-permission.ts";
import type { ReportRequest } from "../lib/report-types.ts";

const SCHEMA = fs.readFileSync(
  path.join(process.cwd(), "lib", "schema.sql"),
  "utf-8",
);

const FORMAL_PATH = path.join(process.cwd(), "data", "publishing-process.db");
const TABLES = ["companies", "users", "books", "tasks", "task_events", "audit_log"];

function formalCounts(): Record<string, number> {
  const r: Record<string, number> = {};
  if (!fs.existsSync(FORMAL_PATH)) return r;
  const db = new Database(FORMAL_PATH, { readonly: true });
  for (const t of TABLES) {
    r[t] = (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;
  }
  db.close();
  return r;
}

const FORMAL_BASELINE = formalCounts();

// 东八区指定日期 12:00 的 UTC ISO 字符串，避免落在自然日边界上。
function shIso(year: number, month: number, day: number, hour = 12): string {
  return toIso(shanghaiDayStartMs(year, month, day) + hour * 3600 * 1000);
}

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  db.prepare(
    "INSERT INTO companies(id, name, type) VALUES (1, '社内', 'INTERNAL'), (2, '外校A', 'EXTERNAL'), (3, '外校B', 'EXTERNAL')",
  ).run();
  db.prepare(
    `INSERT INTO users(id, username, display_name, role, company_id) VALUES
      (1, 'editor1', '编辑甲', 'RESPONSIBLE_EDITOR', 1),
      (2, 'supA', '主管甲', 'EXTERNAL_SUPERVISOR', 2),
      (3, 'supB', '主管乙', 'EXTERNAL_SUPERVISOR', 3),
      (4, 'admin1', '管理员', 'INTERNAL_ADMIN', 1),
      (5, 'pf1', '校对甲', 'PROOFREADER', 2)`,
  ).run();
  return db;
}

function insertBook(db: Database.Database, title: string, editorId = 1): number {
  const r = db.prepare("INSERT INTO books(title, editor_id) VALUES (?, ?)").run(title, editorId);
  return Number(r.lastInsertRowid);
}

function insertTask(
  db: Database.Database,
  o: {
    bookId: number;
    stage?: string;
    starLevel?: number;
    status?: string;
    workWords?: number | null;
    confirmedWords?: number | null;
    publishedAt?: string | null;
    finishedAt?: string | null;
    cancelledAt?: string | null;
    companyId?: number | null;
  },
): number {
  const r = db
    .prepare(
      `INSERT INTO tasks(book_id, stage, work_type, star_level, status,
         work_word_count, external_confirmed_word_count,
         published_at, finished_at, cancelled_at, company_id, publisher_id)
       VALUES (?, ?, 'PROOFREAD', ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(
      o.bookId,
      o.stage ?? "INITIAL_REVIEW",
      o.starLevel ?? 1,
      o.status ?? "PENDING_CONFIRMATION",
      o.workWords ?? null,
      o.confirmedWords ?? null,
      o.publishedAt ?? null,
      o.finishedAt ?? null,
      o.cancelledAt ?? null,
      o.companyId ?? 2,
    );
  return Number(r.lastInsertRowid);
}

function req(
  kind: "MONTHLY" | "HALF_YEAR" | "ANNUAL",
  year: number,
  period: number,
  companyId: number | null = null,
  now: Date = new Date("2026-09-05T00:00:00.000Z"),
): ReportRequest {
  return { kind, year, period, companyId, now };
}

// ===== 日期工具 =====

test("1. UTC 时间转换为 Asia/Shanghai 自然日", () => {
  assert.deepStrictEqual(toShanghaiYMD("2026-08-31T16:00:00.000Z"), {
    year: 2026, month: 9, day: 1,
  }); // UTC 16:00 = 东八区次日 00:00
  assert.deepStrictEqual(toShanghaiYMD("2026-08-31T15:59:59.000Z"), {
    year: 2026, month: 8, day: 31,
  });
});

test("2. 闰年与平年 2 月天数", () => {
  assert.strictEqual(monthLength(2026, 2), 28);
  assert.strictEqual(monthLength(2024, 2), 29);
  assert.strictEqual(monthLength(2026, 4), 30);
  assert.strictEqual(monthLength(2026, 8), 31);
});

test("3. 月起始与结束边界（东八区）", () => {
  assert.strictEqual(toShanghaiYMD(new Date(monthStartMs(2026, 8))).day, 1);
  assert.strictEqual(toShanghaiYMD(new Date(monthEndMs(2026, 8) - 1)).month, 8);
  assert.strictEqual(toShanghaiYMD(new Date(monthEndMs(2026, 8))).day, 1); // 次月 1 日
  assert.strictEqual(toShanghaiYMD(new Date(monthEndMs(2026, 12))).year, 2027); // 跨年
});

// ===== 周期判定 =====

test("4. 月报：期间结束后为实绩版", () => {
  const s = buildPeriodSpec("MONTHLY", 2026, 8, new Date("2026-09-01T00:00:00.000Z"));
  assert.strictEqual(s.status, "ACTUAL");
  assert.strictEqual(s.actualMonths.length, 1);
});

test("5. 月报：31 天月份的 30 日为预测版（第 31 日预测）", () => {
  const s = buildPeriodSpec("MONTHLY", 2026, 8, new Date("2026-08-30T00:00:00.000Z"));
  assert.strictEqual(s.status, "FORECAST");
  assert.deepStrictEqual(s.dayLevel, { actualDays: 30, remainingDays: 1 });
});

test("6. 月报：30 天月份的最后一天为实绩版", () => {
  const s = buildPeriodSpec("MONTHLY", 2026, 4, new Date("2026-04-30T00:00:00.000Z"));
  assert.strictEqual(s.status, "ACTUAL");
});

test("7. 半年报：6 月为预测版，7 月后为实绩版", () => {
  const f = buildPeriodSpec("HALF_YEAR", 2026, 1, new Date("2026-06-01T00:00:00.000Z"));
  assert.strictEqual(f.status, "FORECAST");
  assert.strictEqual(f.actualMonths.length, 5); // 1-5 月
  assert.deepStrictEqual(f.forecastMonths, [{ year: 2026, month: 6 }]);

  const a = buildPeriodSpec("HALF_YEAR", 2026, 1, new Date("2026-07-01T00:00:00.000Z"));
  assert.strictEqual(a.status, "ACTUAL");
});

test("8. 年报：12 月为预测版，次年 1 月为实绩版", () => {
  const f = buildPeriodSpec("ANNUAL", 2026, 0, new Date("2026-12-01T00:00:00.000Z"));
  assert.strictEqual(f.status, "FORECAST");
  assert.strictEqual(f.actualMonths.length, 11);
  assert.deepStrictEqual(f.forecastMonths, [{ year: 2026, month: 12 }]);

  const a = buildPeriodSpec("ANNUAL", 2026, 0, new Date("2027-01-01T00:00:00.000Z"));
  assert.strictEqual(a.status, "ACTUAL");
});

test("9. 期间自然月列表正确", () => {
  assert.strictEqual(periodMonths("MONTHLY", 2026, 8).length, 1);
  assert.strictEqual(periodMonths("HALF_YEAR", 2026, 2)[0].month, 7);
  assert.strictEqual(periodMonths("ANNUAL", 2026, 0).length, 12);
});

// ===== 平滑预测 =====

test("10. 移动平均：3 个月正常", () => {
  assert.deepStrictEqual(movingAverage([100, 200, 300]), { value: 200, note: null });
});

test("11. 移动平均：只有 1-2 个月低可信提示", () => {
  assert.deepStrictEqual(movingAverage([100]), { value: 100, note: LOW_CONFIDENCE_NOTE });
  assert.deepStrictEqual(movingAverage([100, 300]), { value: 200, note: LOW_CONFIDENCE_NOTE });
});

test("12. 移动平均：无历史数据无法预测", () => {
  assert.deepStrictEqual(movingAverage([]), { value: null, note: NO_DATA_NOTE });
});

test("13. 移动平均只取最近 3 个月", () => {
  assert.strictEqual(movingAverage([10, 10, 10, 100, 200, 300]).value, 200);
});

// ===== 统计服务 =====

test("14. 同一本书一校、二校计为 2 本次", () => {
  const db = freshDb();
  const book = insertBook(db, "红楼梦");
  insertTask(db, { bookId: book, stage: "FIRST_PROOF", status: "COMPLETED",
    workWords: 1000, confirmedWords: 1000,
    publishedAt: shIso(2026, 8, 1), finishedAt: shIso(2026, 8, 5) });
  insertTask(db, { bookId: book, stage: "SECOND_PROOF", status: "COMPLETED",
    workWords: 2000, confirmedWords: 2000,
    publishedAt: shIso(2026, 8, 6), finishedAt: shIso(2026, 8, 10) });
  const r = computeReport(db, req("MONTHLY", 2026, 8));
  assert.strictEqual(r.incomingCount.actual, 2);
  assert.strictEqual(r.completedCount.actual, 2);
  db.close();
});

test("15. 来稿量与完成量按期间统计", () => {
  const db = freshDb();
  const book = insertBook(db, "书");
  // 8 月发布但未完成
  insertTask(db, { bookId: book, status: "READY_TO_START", publishedAt: shIso(2026, 8, 10) });
  // 8 月完成
  insertTask(db, { bookId: book, status: "COMPLETED", publishedAt: shIso(2026, 8, 1), finishedAt: shIso(2026, 8, 20) });
  // 9 月发布（不在 8 月期间）
  insertTask(db, { bookId: book, publishedAt: shIso(2026, 9, 1) });
  const r = computeReport(db, req("MONTHLY", 2026, 8));
  assert.strictEqual(r.incomingCount.actual, 2);
  assert.strictEqual(r.completedCount.actual, 1);
  db.close();
});

test("16. 工作字数与外校确认字数分别汇总，NULL 不计入但进缺失提示", () => {
  const db = freshDb();
  const book = insertBook(db, "书");
  insertTask(db, { bookId: book, status: "COMPLETED",
    workWords: 1000, confirmedWords: 2000,
    publishedAt: shIso(2026, 8, 1), finishedAt: shIso(2026, 8, 5) });
  insertTask(db, { bookId: book, status: "COMPLETED",
    workWords: null, confirmedWords: null, // 双缺失
    publishedAt: shIso(2026, 8, 6), finishedAt: shIso(2026, 8, 10) });
  const r = computeReport(db, req("MONTHLY", 2026, 8));
  assert.strictEqual(r.incomingWords.actual, 1000);
  assert.strictEqual(r.completedWords.actual, 2000);
  assert.strictEqual(r.missingWorkWordsCount, 1);
  assert.strictEqual(r.missingConfirmedWordsCount, 1);
  db.close();
});

test("17. 按期完成与超期完成区分（复用阈值）", () => {
  const db = freshDb();
  const book = insertBook(db, "书");
  // 按期：10 天 <= 30 天阈值
  insertTask(db, { bookId: book, stage: "FIRST_PROOF", status: "COMPLETED",
    confirmedWords: 1000,
    publishedAt: shIso(2026, 8, 1), finishedAt: shIso(2026, 8, 10) });
  // 超期：40 天 > 30 天阈值
  insertTask(db, { bookId: book, stage: "FIRST_PROOF", status: "COMPLETED",
    confirmedWords: 1000,
    publishedAt: shIso(2026, 7, 1), finishedAt: shIso(2026, 8, 10) });
  const r = computeReport(db, req("MONTHLY", 2026, 8));
  assert.strictEqual(r.onTimeCount.actual, 1);
  db.close();
});

test("18. 统计截止时的滞留任务", () => {
  const db = freshDb();
  const book = insertBook(db, "书");
  // 发布很久、未完成、未取消 → 8 月末滞留
  insertTask(db, { bookId: book, stage: "FIRST_PROOF", status: "READY_TO_START",
    publishedAt: shIso(2026, 7, 1) }); // 到 8 月底已 61 天 > 30
  insertTask(db, { bookId: book, stage: "FIRST_PROOF", status: "READY_TO_START",
    publishedAt: shIso(2026, 8, 25) }); // 仅 6 天，不滞留
  const r = computeReport(db, req("MONTHLY", 2026, 8));
  assert.strictEqual(r.overdueCount.actual, 1);
  db.close();
});

test("19. 截止后才完成的任务在历史截止日仍计滞留", () => {
  const db = freshDb();
  const book = insertBook(db, "书");
  // 8 月内超期未完成，9 月才完成 → 在 8 月截止时应计滞留
  insertTask(db, { bookId: book, stage: "FIRST_PROOF", status: "COMPLETED",
    publishedAt: shIso(2026, 7, 1), finishedAt: shIso(2026, 9, 10) });
  const r = computeReport(db, req("MONTHLY", 2026, 8, null, new Date("2026-09-05T00:00:00.000Z")));
  assert.strictEqual(r.overdueCount.actual, 1);
  db.close();
});

test("20. CANCELLED 不进入任何统计", () => {
  const db = freshDb();
  const book = insertBook(db, "书");
  insertTask(db, { bookId: book, status: "CANCELLED",
    workWords: 1000, confirmedWords: 1000,
    publishedAt: shIso(2026, 8, 1), cancelledAt: shIso(2026, 8, 3) });
  const r = computeReport(db, req("MONTHLY", 2026, 8));
  assert.strictEqual(r.incomingCount.actual, 0);
  assert.strictEqual(r.completedCount.actual, 0);
  assert.strictEqual(r.overdueCount.actual, 0);
  db.close();
});

test("21. 平均 50 万字完成周期公式", () => {
  const db = freshDb();
  const book = insertBook(db, "书");
  // 完成周期 10 天，外校确认字数 500000 → 10 天/50万字
  insertTask(db, { bookId: book, status: "COMPLETED", confirmedWords: 500000,
    publishedAt: shIso(2026, 8, 1), finishedAt: shIso(2026, 8, 11) });
  // 字数缺失，不进入公式
  insertTask(db, { bookId: book, status: "COMPLETED", confirmedWords: null,
    publishedAt: shIso(2026, 8, 1), finishedAt: shIso(2026, 8, 2) });
  const r = computeReport(db, req("MONTHLY", 2026, 8));
  assert.strictEqual(r.avgCycle500kDays, 10);
  db.close();
});

test("22. 31 天月份第 31 日预测（日级日均值）", () => {
  const db = freshDb();
  const book = insertBook(db, "书");
  // 前 30 天来稿 30 次，日均 1 次 → 第 31 日预测 1 次
  for (let d = 1; d <= 30; d++) {
    insertTask(db, { bookId: book, publishedAt: shIso(2026, 8, d) });
  }
  const r = computeReport(db, req("MONTHLY", 2026, 8, null, new Date("2026-08-30T00:00:00.000Z")));
  assert.strictEqual(r.status, "FORECAST");
  assert.strictEqual(r.incomingCount.actual, 30);
  assert.strictEqual(r.incomingCount.forecast, 1);
  db.close();
});

test("23. 半年报 6 月移动平均（3-5 月）", () => {
  const db = freshDb();
  const book = insertBook(db, "书");
  // 3/4/5 月来稿量分别为 10/20/30
  for (let i = 0; i < 10; i++) insertTask(db, { bookId: book, publishedAt: shIso(2026, 3, 1 + i) });
  for (let i = 0; i < 20; i++) insertTask(db, { bookId: book, publishedAt: shIso(2026, 4, 1 + (i % 28)) });
  for (let i = 0; i < 30; i++) insertTask(db, { bookId: book, publishedAt: shIso(2026, 5, 1 + (i % 30)) });
  const r = computeReport(db, req("HALF_YEAR", 2026, 1, null, new Date("2026-06-01T00:00:00.000Z")));
  assert.strictEqual(r.status, "FORECAST");
  assert.strictEqual(r.incomingCount.actual, 60); // 10+20+30
  assert.strictEqual(r.incomingCount.forecast, 20); // (10+20+30)/3
  db.close();
});

test("24. 年报 12 月移动平均（9-11 月）", () => {
  const db = freshDb();
  const book = insertBook(db, "书");
  for (let i = 0; i < 10; i++) insertTask(db, { bookId: book, publishedAt: shIso(2026, 9, 1 + i) });
  for (let i = 0; i < 20; i++) insertTask(db, { bookId: book, publishedAt: shIso(2026, 10, 1 + (i % 30)) });
  for (let i = 0; i < 30; i++) insertTask(db, { bookId: book, publishedAt: shIso(2026, 11, 1 + (i % 29)) });
  const r = computeReport(db, req("ANNUAL", 2026, 0, null, new Date("2026-12-01T00:00:00.000Z")));
  assert.strictEqual(r.status, "FORECAST");
  assert.strictEqual(r.incomingCount.forecast, 20); // (10+20+30)/3
  db.close();
});

test("25. 超级管理员全局范围 vs 外校主管仅本公司范围", () => {
  const db = freshDb();
  const book = insertBook(db, "书");
  insertTask(db, { bookId: book, publishedAt: shIso(2026, 8, 1), companyId: 2 });
  insertTask(db, { bookId: book, publishedAt: shIso(2026, 8, 2), companyId: 2 });
  insertTask(db, { bookId: book, publishedAt: shIso(2026, 8, 3), companyId: 3 });
  const all = computeReport(db, req("MONTHLY", 2026, 8, null));
  assert.strictEqual(all.incomingCount.actual, 3);
  const comp2 = computeReport(db, req("MONTHLY", 2026, 8, 2));
  assert.strictEqual(comp2.incomingCount.actual, 2);
  const comp3 = computeReport(db, req("MONTHLY", 2026, 8, 3));
  assert.strictEqual(comp3.incomingCount.actual, 1);
  db.close();
});

test("26. 自动测试不污染正式数据库", () => {
  if (!fs.existsSync(FORMAL_PATH)) return;
  assert.deepStrictEqual(formalCounts(), FORMAL_BASELINE);
});

// ===== 权限 =====

test("27. 仅管理员与外校主管可访问报表中心", () => {
  assert.strictEqual(canAccessReport("INTERNAL_ADMIN"), true);
  assert.strictEqual(canAccessReport("EXTERNAL_SUPERVISOR"), true);
  assert.strictEqual(canAccessReport("RESPONSIBLE_EDITOR"), false);
  assert.strictEqual(canAccessReport("PROOFREADER"), false);
});

test("28. 报表公司范围由角色决定（不信任前端）", () => {
  assert.strictEqual(reportCompanyScope("INTERNAL_ADMIN", null), null); // 全局
  assert.strictEqual(reportCompanyScope("INTERNAL_ADMIN", 2), null); // 管理员始终全局
  assert.strictEqual(reportCompanyScope("EXTERNAL_SUPERVISOR", 2), 2); // 本人公司
  assert.strictEqual(reportCompanyScope("EXTERNAL_SUPERVISOR", null), -1); // 无公司=空范围
});

test("29. 报表页面强制服务端权限与公司范围（源码检查）", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "app", "reports", "page.tsx"), "utf-8");
  assert.ok(src.includes("requireReportViewer"));
  assert.ok(src.includes("reportCompanyScope"));
  assert.ok(!src.includes("sp.company"), "不得从 URL 读取 company");
});

test("30. 首页统计报表入口仅管理员与外校主管可见（源码检查）", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "app", "page.tsx"), "utf-8");
  assert.ok(src.includes('href="/reports"'));
  assert.ok(src.includes('user.role === "INTERNAL_ADMIN" || user.role === "EXTERNAL_SUPERVISOR"'));
});
