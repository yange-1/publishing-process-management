import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { buildReminder } from "../lib/reminder.ts";
import {
  publishTask,
  confirmReceipt,
  startTask,
  finishTask,
  cancelTask,
} from "../lib/task-service.ts";
import { listOverdue, overdueThresholdDays } from "../lib/dashboard-service.ts";

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

const NOW = new Date("2026-08-22T00:00:00.000Z");

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  db.prepare(
    "INSERT INTO companies(id, name, type) VALUES (1, '社内', 'INTERNAL'), (2, '外校A', 'EXTERNAL')",
  ).run();
  db.prepare(
    `INSERT INTO users(id, username, display_name, role, company_id) VALUES
      (1, 'editor1', '编辑甲', 'RESPONSIBLE_EDITOR', 1),
      (2, 'sup1', '主管甲', 'EXTERNAL_SUPERVISOR', 2),
      (3, 'pf1', '校对甲', 'PROOFREADER', 2)`,
  ).run();
  return db;
}

function publish(db: Database.Database, title = "红楼梦"): number {
  return publishTask(db, {
    operatorId: 1,
    bookTitle: title,
    stage: "INITIAL_REVIEW",
    starLevel: 1,
    companyId: 2,
  });
}

function age(db: Database.Database, taskId: number, daysAgo: number): void {
  db.prepare("UPDATE tasks SET published_at = ? WHERE id = ?").run(
    new Date(NOW.getTime() - daysAgo * 86400000).toISOString(),
    taskId,
  );
}

test("1. 达到阈值当天：中文逗号", () => {
  assert.strictEqual(
    buildReminder({ waitDays: 30, thresholdDays: 30, exceedDays: 0 }),
    "已收稿30天，请尽快处理！",
  );
});

test("2. 超过阈值1天：中文感叹号", () => {
  assert.strictEqual(
    buildReminder({ waitDays: 31, thresholdDays: 30, exceedDays: 1 }),
    "已收稿31天！请尽快处理！",
  );
});

test("3. 超过阈值多天", () => {
  assert.strictEqual(
    buildReminder({ waitDays: 33, thresholdDays: 30, exceedDays: 3 }),
    "已收稿33天！请尽快处理！",
  );
});

test("4. 未达到阈值不生成提示", () => {
  assert.strictEqual(buildReminder({ waitDays: 29, thresholdDays: 30, exceedDays: -1 }), "");
});

test("5. 达到当天与超过使用不同标点，且不含书名/书稿/管理人员", () => {
  const reached = buildReminder({ waitDays: 30, thresholdDays: 30, exceedDays: 0 });
  const exceeded = buildReminder({ waitDays: 31, thresholdDays: 30, exceedDays: 1 });
  assert.ok(reached.endsWith("天，请尽快处理！"));
  assert.ok(exceeded.endsWith("天！请尽快处理！"));
  for (const s of [reached, exceeded]) {
    assert.ok(!s.includes("《"));
    assert.ok(!s.includes("书稿"));
    assert.ok(!s.includes("管理人员"));
  }
});

test("6. 阈值计算复用 dashboard-service 的 overdueThresholdDays", () => {
  assert.strictEqual(overdueThresholdDays("INITIAL_REVIEW", 1), 90);
  assert.strictEqual(overdueThresholdDays("FIRST_PROOF", 1), 30);
  assert.strictEqual(overdueThresholdDays("FIRST_PROOF", 2), 15);
  assert.strictEqual(overdueThresholdDays("FIRST_PROOF", 3), 7);
});

test("7. listOverdue 包含达到阈值当天的任务", () => {
  const db = freshDb();
  const id = publish(db);
  age(db, id, 90); // 初审阈值 90 天，恰好达到
  const r = listOverdue(db, NOW);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].id, id);
  assert.strictEqual(r[0].exceedDays, 0);
  db.close();
});

test("8. listOverdue 不包含未达到阈值的任务", () => {
  const db = freshDb();
  const id = publish(db);
  age(db, id, 89); // 未达到 90 天
  assert.deepStrictEqual(listOverdue(db, NOW), []);
  db.close();
});

test("9. COMPLETED 不生成提醒", () => {
  const db = freshDb();
  const id = publish(db);
  confirmReceipt(db, id, 2);
  startTask(db, id, 3);
  finishTask(db, id, 3);
  age(db, id, 100);
  assert.deepStrictEqual(listOverdue(db, NOW), []);
  db.close();
});

test("10. CANCELLED 不生成提醒", () => {
  const db = freshDb();
  const id = publish(db);
  cancelTask(db, id, 1, "误发"); // 责任编辑取消自己发布的任务
  age(db, id, 100);
  assert.deepStrictEqual(listOverdue(db, NOW), []);
  db.close();
});

test("11. 预警卡片不再向 buildReminder 传入书名与状态", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "components", "DashboardOverdueRow.tsx"),
    "utf-8",
  );
  assert.ok(src.includes("buildReminder"));
  assert.ok(!src.includes("title:"));
  assert.ok(!src.includes("status:"));
});

test("12. 自动测试不污染正式数据库", () => {
  if (!fs.existsSync(FORMAL_PATH)) return;
  assert.deepStrictEqual(formalCounts(), FORMAL_BASELINE);
});
