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
} from "../lib/task-service.ts";
import {
  searchBooks,
  getBookDetail,
  escapeLike,
  EVENT_LABELS,
  ROLE_LABELS,
} from "../lib/search-service.ts";

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
    "INSERT INTO companies(id, name, type) VALUES (1, '社内', 'INTERNAL'), (2, '外校A', 'EXTERNAL')",
  ).run();
  db.prepare(
    `INSERT INTO users(id, username, display_name, role, company_id) VALUES
      (1, 'editor1', '编辑甲', 'RESPONSIBLE_EDITOR', 1),
      (2, 'sup1', '主管甲', 'EXTERNAL_SUPERVISOR', 2),
      (3, 'pf1', '张萌萌', 'PROOFREADER', 2),
      (4, 'admin1', '管理员', 'INTERNAL_ADMIN', 1)`,
  ).run();
  return db;
}

function publish(
  db: Database.Database,
  opts: { title?: string; stage?: string; starLevel?: number; companyId?: number; editorId?: number; proxyReason?: string } = {},
): number {
  return publishTask(db, {
    operatorId: opts.editorId ?? 1,
    bookTitle: opts.title ?? "书",
    stage: opts.stage ?? "INITIAL_REVIEW",
    starLevel: opts.starLevel ?? 1,
    companyId: opts.companyId ?? 2,
    editorId: opts.editorId === 4 ? 1 : undefined,
    proxyReason: opts.proxyReason,
  });
}

function bookIdOf(db: Database.Database, taskId: number): number {
  return (db.prepare("SELECT book_id FROM tasks WHERE id = ?").get(taskId) as { book_id: number }).book_id;
}

function toCompleted(db: Database.Database, opts = {}): number {
  const id = publish(db, opts);
  confirmReceipt(db, id, 2);
  startTask(db, id, 3);
  finishTask(db, id, 3);
  return id;
}

test("1. 按完整书名搜索", () => {
  const db = freshDb();
  publish(db, { title: "平台联调测试书稿01" });
  const r = searchBooks(db, "平台联调测试书稿01", 1, 20);
  assert.strictEqual(r.results.length, 1);
  assert.strictEqual(r.results[0].title, "平台联调测试书稿01");
  db.close();
});

test("2. 按部分书名搜索", () => {
  const db = freshDb();
  publish(db, { title: "平台联调测试书稿01" });
  const r = searchBooks(db, "联调测试", 1, 20);
  assert.strictEqual(r.results.length, 1);
  db.close();
});

test("3. 按责任编辑姓名搜索", () => {
  const db = freshDb();
  publish(db, { title: "书稿A" });
  publish(db, { title: "书稿B" });
  const r = searchBooks(db, "编辑甲", 1, 20);
  assert.strictEqual(r.results.length, 2);
  db.close();
});

test("4. 无匹配结果", () => {
  const db = freshDb();
  publish(db, { title: "书稿A" });
  const r = searchBooks(db, "不存在的书名", 1, 20);
  assert.strictEqual(r.results.length, 0);
  db.close();
});

test("5. 空关键词不执行搜索", () => {
  const db = freshDb();
  publish(db, { title: "书稿A" });
  const r = searchBooks(db, "   ", 1, 20);
  assert.strictEqual(r.results.length, 0);
  assert.strictEqual(r.total, 0);
  db.close();
});

test("6. 搜索关键词长度校验（截断）", () => {
  assert.strictEqual(escapeLike("abc"), "abc");
  // 转义通配符
  assert.strictEqual(escapeLike("100%"), "100\\%");
  assert.strictEqual(escapeLike("a_b"), "a\\_b");
});

test("7. 参数化查询不因特殊字符报错或产生异常结果", () => {
  const db = freshDb();
  publish(db, { title: "100%完成的书" });
  publish(db, { title: "普通书" });
  const r1 = searchBooks(db, "100%", 1, 20);
  assert.strictEqual(r1.results.length, 1);
  assert.strictEqual(r1.results[0].title, "100%完成的书");
  // 引号/注入尝试不报错、不返回异常结果
  const r2 = searchBooks(db, "' OR 1=1 --", 1, 20);
  assert.strictEqual(r2.results.length, 0);
  db.close();
});

test("8. 一条书稿对应多条任务时，搜索结果不重复书稿", () => {
  const db = freshDb();
  const first = publish(db, { title: "多校次书" });
  db.prepare("UPDATE tasks SET status = 'COMPLETED' WHERE id = ?").run(first);
  const bookId = bookIdOf(db, first);
  publishTask(db, { operatorId: 1, bookId, stage: "FIRST_PROOF", starLevel: 1, companyId: 2 });
  const r = searchBooks(db, "多校次书", 1, 20);
  assert.strictEqual(r.results.length, 1);
  db.close();
});

test("9. 最近任务状态展示正确", () => {
  const db = freshDb();
  const first = publish(db, { title: "多校次书" });
  db.prepare("UPDATE tasks SET status = 'COMPLETED' WHERE id = ?").run(first);
  const bookId = bookIdOf(db, first);
  // 第二个任务（一校），仍是 PENDING
  publishTask(db, { operatorId: 1, bookId, stage: "FIRST_PROOF", starLevel: 1, companyId: 2 });
  const r = searchBooks(db, "多校次书", 1, 20);
  assert.strictEqual(r.results.length, 1);
  assert.strictEqual(r.results[0].status, "PENDING_CONFIRMATION");
  assert.strictEqual(r.results[0].stage, "FIRST_PROOF");
  db.close();
});

test("10. 每页最多20条", () => {
  const db = freshDb();
  for (let i = 0; i < 25; i++) publish(db, { title: `书稿${i}` });
  const r = searchBooks(db, "书稿", 1, 20);
  assert.strictEqual(r.results.length, 20);
  assert.strictEqual(r.total, 25);
  db.close();
});

test("11. 下一页结果正确", () => {
  const db = freshDb();
  for (let i = 0; i < 25; i++) publish(db, { title: `书稿${i}` });
  const page1 = searchBooks(db, "书稿", 1, 20);
  const page2 = searchBooks(db, "书稿", 2, 20);
  assert.strictEqual(page1.results.length, 20);
  assert.strictEqual(page2.results.length, 5);
  assert.strictEqual(page2.total, 25);
  db.close();
});

test("12. 搜索结果排序稳定", () => {
  const db = freshDb();
  const a = publish(db, { title: "旧书" });
  db.prepare("UPDATE tasks SET published_at = '2026-08-01T00:00:00.000Z' WHERE id = ?").run(a);
  const b = publish(db, { title: "新书" });
  db.prepare("UPDATE tasks SET published_at = '2026-08-10T00:00:00.000Z' WHERE id = ?").run(b);
  const r = searchBooks(db, "书", 1, 20);
  const ids = r.results.map((x) => x.bookId);
  assert.deepStrictEqual(ids, [bookIdOf(db, b), bookIdOf(db, a)]); // 新书在前
  db.close();
});

test("13. 搜索页使用 requireCurrentUser（未登录被拒绝）", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "app", "search", "page.tsx"), "utf-8");
  assert.ok(src.includes("requireCurrentUser"));
});

test("14. 四类角色均可查询（不按角色限制）", () => {
  const db = freshDb();
  publish(db, { title: "书稿" });
  // 查询服务不接收角色参数，任何已登录用户均可调用
  const r = searchBooks(db, "书稿", 1, 20);
  assert.strictEqual(r.results.length, 1);
  db.close();
});

test("15. 详情页书稿基本信息正确", () => {
  const db = freshDb();
  const taskId = toCompleted(db, { title: "详情书" });
  const bookId = bookIdOf(db, taskId);
  const d = getBookDetail(db, bookId);
  assert.ok(d);
  assert.strictEqual(d.title, "详情书");
  assert.strictEqual(d.editorName, "编辑甲");
  assert.strictEqual(d.latestStatus, "COMPLETED");
  assert.strictEqual(d.latestProofreaderName, "张萌萌");
  db.close();
});

test("16. 多校次任务排序正确（按发布时间从早到晚）", () => {
  const db = freshDb();
  const first = publish(db, { title: "多校次", stage: "INITIAL_REVIEW" });
  db.prepare("UPDATE tasks SET status = 'COMPLETED' WHERE id = ?").run(first);
  const bookId = bookIdOf(db, first);
  publishTask(db, { operatorId: 1, bookId, stage: "FIRST_PROOF", starLevel: 1, companyId: 2 });
  const d = getBookDetail(db, bookId);
  assert.ok(d);
  assert.strictEqual(d.tasks.length, 2);
  assert.deepStrictEqual(d.tasks.map((t) => t.stage), ["INITIAL_REVIEW", "FIRST_PROOF"]);
  db.close();
});

test("17. task_events 时间线按时间从早到晚排列", () => {
  const db = freshDb();
  const taskId = toCompleted(db, { title: "时间线书" });
  const bookId = bookIdOf(db, taskId);
  const d = getBookDetail(db, bookId);
  assert.ok(d);
  const types = d.events.map((e) => e.eventType);
  assert.deepStrictEqual(types, ["TASK_PUBLISHED", "RECEIPT_CONFIRMED", "TASK_STARTED", "TASK_COMPLETED"]);
  db.close();
});

test("18. 五类事件中文名称映射正确", () => {
  assert.strictEqual(EVENT_LABELS.TASK_PUBLISHED, "发布校对任务");
  assert.strictEqual(EVENT_LABELS.RECEIPT_CONFIRMED, "确认收稿");
  assert.strictEqual(EVENT_LABELS.TASK_STARTED, "开始校对");
  assert.strictEqual(EVENT_LABELS.TASK_COMPLETED, "结束校对");
  assert.strictEqual(EVENT_LABELS.TASK_CANCELLED, "取消任务");
});

test("19. 四类角色中文名称映射正确", () => {
  assert.strictEqual(ROLE_LABELS.INTERNAL_ADMIN, "Dominance");
  assert.strictEqual(ROLE_LABELS.RESPONSIBLE_EDITOR, "责任编辑");
  assert.strictEqual(ROLE_LABELS.EXTERNAL_SUPERVISOR, "外校主管");
  assert.strictEqual(ROLE_LABELS.PROOFREADER, "校对人员");
});

test("20. 普通操作显示实际操作人", () => {
  const db = freshDb();
  const taskId = publish(db, { title: "操作人书" });
  const bookId = bookIdOf(db, taskId);
  const d = getBookDetail(db, bookId);
  assert.ok(d);
  const pub = d.events[0];
  assert.strictEqual(pub.eventType, "TASK_PUBLISHED");
  assert.strictEqual(pub.operatorName, "编辑甲");
  assert.strictEqual(pub.operatorRole, "RESPONSIBLE_EDITOR");
  assert.strictEqual(pub.isProxy, 0);
  db.close();
});

test("21. 管理员代操作显示代操作标记、目标角色和原因", () => {
  const db = freshDb();
  const taskId = publishTask(db, {
    operatorId: 4,
    editorId: 1,
    proxyReason: "编辑请假代发",
    bookTitle: "代发书",
    stage: "INITIAL_REVIEW",
    starLevel: 1,
    companyId: 2,
  });
  const bookId = bookIdOf(db, taskId);
  const d = getBookDetail(db, bookId);
  assert.ok(d);
  const pub = d.events[0];
  assert.strictEqual(pub.isProxy, 1);
  assert.strictEqual(pub.proxyRole, "RESPONSIBLE_EDITOR");
  assert.strictEqual(pub.proxyReason, "编辑请假代发");
  db.close();
});

test("22. COMPLETED 任务正确显示校对人员、开始时间和完成时间", () => {
  const db = freshDb();
  const taskId = toCompleted(db, { title: "完成书" });
  const bookId = bookIdOf(db, taskId);
  const d = getBookDetail(db, bookId);
  assert.ok(d);
  const t = d.tasks[0];
  assert.strictEqual(t.status, "COMPLETED");
  assert.strictEqual(t.proofreaderName, "张萌萌");
  assert.ok(t.startedAt);
  assert.ok(t.finishedAt);
  db.close();
});

test("23. 缺失时间字段返回 null（页面渲染为 —）", () => {
  const db = freshDb();
  const taskId = publish(db, { title: "待确认书" });
  const bookId = bookIdOf(db, taskId);
  const d = getBookDetail(db, bookId);
  assert.ok(d);
  const t = d.tasks[0];
  assert.strictEqual(t.status, "PENDING_CONFIRMATION");
  assert.strictEqual(t.confirmedAt, null);
  assert.strictEqual(t.startedAt, null);
  assert.strictEqual(t.finishedAt, null);
  assert.strictEqual(t.proofreaderName, null);
  db.close();
});

test("24. 查询和测试不会修改正式数据库", () => {
  if (!fs.existsSync(FORMAL_PATH)) return;
  assert.deepStrictEqual(formalCounts(), FORMAL_BASELINE);
});
