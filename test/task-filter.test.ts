import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  publishTask,
  confirmReceipt,
  startTask,
  finishTask,
  cancelTask,
} from "../lib/task-service.ts";
import {
  filterTasks,
  listFilterOptions,
  parseTaskFilter,
  hasActiveFilter,
  FILTER_STATUSES,
} from "../lib/task-filter-service.ts";
import { STAGES } from "../lib/task-service.ts";

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
      (2, 'sup1', '主管甲', 'EXTERNAL_SUPERVISOR', 2),
      (3, 'pf1', '校对甲', 'PROOFREADER', 2),
      (4, 'admin1', '管理员', 'INTERNAL_ADMIN', 1),
      (5, 'pf2', '校对乙', 'PROOFREADER', 2),
      (6, 'editor2', '编辑乙', 'RESPONSIBLE_EDITOR', 1),
      (7, 'sup2', '主管乙', 'EXTERNAL_SUPERVISOR', 3),
      (8, 'pf3', '校对丙', 'PROOFREADER', 3)`,
  ).run();
  return db;
}

interface PubOpts {
  editorId?: number;
  title?: string;
  stage?: string;
  starLevel?: number;
  companyId?: number;
}

function publish(db: Database.Database, opts: PubOpts = {}): number {
  return publishTask(db, {
    operatorId: opts.editorId ?? 1,
    bookTitle: opts.title ?? "书",
    stage: opts.stage ?? "INITIAL_REVIEW",
    starLevel: opts.starLevel ?? 1,
    companyId: opts.companyId ?? 2,
  });
}

function confirm(db: Database.Database, taskId: number, companyId: number): void {
  confirmReceipt(db, taskId, companyId === 3 ? 7 : 2);
}

function toReady(db: Database.Database, opts: PubOpts = {}): number {
  const id = publish(db, opts);
  confirm(db, id, opts.companyId ?? 2);
  return id;
}

function toInProgress(db: Database.Database, opts: PubOpts = {}, proofreaderId = 3): number {
  const id = toReady(db, opts);
  startTask(db, id, proofreaderId);
  return id;
}

function toCompleted(db: Database.Database, opts: PubOpts = {}, proofreaderId = 3): number {
  const id = toInProgress(db, opts, proofreaderId);
  finishTask(db, id, proofreaderId);
  return id;
}

test("1. 无筛选返回全部任务（含已取消）", () => {
  const db = freshDb();
  const a = publish(db, { title: "待确认" });
  const b = toReady(db, { title: "待开始" });
  const c = toInProgress(db, { title: "进行中" }, 3);
  const d = toCompleted(db, { title: "已完成" }, 5);
  const e = publish(db, { title: "已取消" });
  cancelTask(db, e, 4, "误发");

  const ids = filterTasks(db, {
    editorId: null,
    proofreaderId: null,
    stage: null,
    status: null,
  }).map((t) => t.id);
  assert.deepStrictEqual(ids.sort((x, y) => x - y), [a, b, c, d, e].sort((x, y) => x - y));
  db.close();
});

test("2. 按责任编辑筛选（书稿归属 editor_id）", () => {
  const db = freshDb();
  const mine = publish(db, { editorId: 1, title: "甲的书" });
  publish(db, { editorId: 6, title: "乙的书" });

  const r = filterTasks(db, { editorId: 1, proofreaderId: null, stage: null, status: null });
  assert.deepStrictEqual(r.map((t) => t.id), [mine]);
  db.close();
});

test("3. 按校对负责人筛选（proofreader_id）", () => {
  const db = freshDb();
  const byPf1 = toCompleted(db, { title: "甲完成" }, 3);
  toCompleted(db, { title: "乙完成" }, 5);

  const r = filterTasks(db, { editorId: null, proofreaderId: 3, stage: null, status: null });
  assert.deepStrictEqual(r.map((t) => t.id), [byPf1]);
  db.close();
});

test("4. 按校次筛选（stage）", () => {
  const db = freshDb();
  publish(db, { title: "初审书", stage: "INITIAL_REVIEW" });
  publish(db, { title: "一校书", stage: "FIRST_PROOF" });

  const r = filterTasks(db, { editorId: null, proofreaderId: null, stage: "FIRST_PROOF", status: null });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].title, "一校书");
  db.close();
});

test("5. 按状态筛选（含已取消）", () => {
  const db = freshDb();
  publish(db, { title: "待确认" });
  toCompleted(db, { title: "已完成" });
  const c = publish(db, { title: "已取消" });
  cancelTask(db, c, 4, "误发");

  const cancelled = filterTasks(db, { editorId: null, proofreaderId: null, stage: null, status: "CANCELLED" });
  assert.deepStrictEqual(cancelled.map((t) => t.id), [c]);

  const completed = filterTasks(db, { editorId: null, proofreaderId: null, stage: null, status: "COMPLETED" });
  assert.strictEqual(completed.length, 1);
  assert.strictEqual(completed[0].title, "已完成");
  db.close();
});

test("6. 多条件 AND 组合筛选", () => {
  const db = freshDb();
  // 甲的书，一校，已完成（校对甲）
  toCompleted(db, { editorId: 1, title: "目标", stage: "FIRST_PROOF" }, 3);
  // 甲的书，初审，已完成（校对甲）——校次不符
  toCompleted(db, { editorId: 1, title: "校次不符", stage: "INITIAL_REVIEW" }, 3);
  // 乙的书，一校，已完成（校对甲）——编辑不符
  toCompleted(db, { editorId: 6, title: "编辑不符", stage: "FIRST_PROOF" }, 3);

  const r = filterTasks(db, {
    editorId: 1,
    proofreaderId: 3,
    stage: "FIRST_PROOF",
    status: "COMPLETED",
  });
  assert.deepStrictEqual(r.map((t) => t.title), ["目标"]);
  db.close();
});

test("7. parseTaskFilter 忽略非法值（非正整数、未知校次/状态）", () => {
  const f = parseTaskFilter({
    editor: "abc",
    proofreader: "-1",
    stage: "RED_CHECK",
    status: "NOT_A_STATUS",
  });
  assert.deepStrictEqual(f, { editorId: null, proofreaderId: null, stage: null, status: null });
  assert.strictEqual(hasActiveFilter(f), false);
});

test("8. parseTaskFilter 解析合法值", () => {
  const f = parseTaskFilter({
    editor: "6",
    proofreader: "3",
    stage: "FIRST_PROOF",
    status: "COMPLETED",
  });
  assert.deepStrictEqual(f, {
    editorId: 6,
    proofreaderId: 3,
    stage: "FIRST_PROOF",
    status: "COMPLETED",
  });
  assert.strictEqual(hasActiveFilter(f), true);
});

test("9. 筛选结果按发布时间倒序稳定排序", () => {
  const db = freshDb();
  const early = publish(db, { title: "早" });
  const late = publish(db, { title: "晚" });
  db.prepare("UPDATE tasks SET published_at = ? WHERE id = ?").run("2026-01-01T00:00:00.000Z", early);
  db.prepare("UPDATE tasks SET published_at = ? WHERE id = ?").run("2026-08-01T00:00:00.000Z", late);

  const r = filterTasks(db, { editorId: null, proofreaderId: null, stage: null, status: null });
  assert.deepStrictEqual(r.map((t) => t.id), [late, early]);
  db.close();
});

test("10. 下拉选项来自真实 users，校次与状态全集正确", () => {
  const db = freshDb();
  const opts = listFilterOptions(db);
  assert.deepStrictEqual(opts.editors.map((e) => e.id).sort((a, b) => a - b), [1, 6]);
  assert.deepStrictEqual(opts.proofreaders.map((p) => p.id).sort((a, b) => a - b), [3, 5, 8]);
  assert.deepStrictEqual(opts.stages.map((s) => s.value), STAGES);
  assert.deepStrictEqual(opts.statuses.map((s) => s.value), FILTER_STATUSES);
  db.close();
});

test("11. 筛选页为服务端组件，回查真实账号，不信任浏览器输入", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "app", "tasks", "page.tsx"),
    "utf-8",
  );
  assert.ok(src.includes("requireCurrentUser"));
  assert.ok(src.includes("filterTasks"));
  assert.ok(src.includes("parseTaskFilter"));
  assert.ok(!src.includes('"use client"'));
  assert.ok(!src.includes("useSearchParams"));
});

test("12. 首页含任务筛选入口", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "app", "page.tsx"), "utf-8");
  assert.ok(src.includes('href="/tasks"'));
});

test("13. 筛选测试不污染正式数据库", () => {
  if (!fs.existsSync(FORMAL_PATH)) return;
  assert.deepStrictEqual(formalCounts(), FORMAL_BASELINE);
});
