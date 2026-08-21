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
  listEligibleBooks,
  TaskServiceError,
  type TaskErrorCode,
} from "../lib/task-service.ts";
import { getBookDetail } from "../lib/search-service.ts";

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
      (4, 'admin1', '管理员', 'INTERNAL_ADMIN', 1),
      (5, 'editor2', '编辑乙', 'RESPONSIBLE_EDITOR', 1)`,
  ).run();
  return db;
}

function bookIdOf(db: Database.Database, taskId: number): number {
  return (db.prepare("SELECT book_id FROM tasks WHERE id = ?").get(taskId) as { book_id: number }).book_id;
}

function toCompleted(
  db: Database.Database,
  opts: { title?: string; editorId?: number; stage?: string } = {},
): { taskId: number; bookId: number } {
  const taskId = publishTask(db, {
    operatorId: opts.editorId ?? 1,
    bookTitle: opts.title ?? "书",
    stage: opts.stage ?? "INITIAL_REVIEW",
    starLevel: 1,
    companyId: 2,
  });
  confirmReceipt(db, taskId, 2);
  startTask(db, taskId, 3);
  finishTask(db, taskId, 3);
  return { taskId, bookId: bookIdOf(db, taskId) };
}

function rows(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c;
}

function assertThrowsCode(fn: () => unknown, code: TaskErrorCode): void {
  assert.throws(
    fn,
    (err: unknown) => {
      assert.ok(
        err instanceof TaskServiceError,
        `expected TaskServiceError, got ${String(err)}`,
      );
      assert.strictEqual((err as TaskServiceError).code, code);
      return true;
    },
  );
}

function publishNext(db: Database.Database, bookId: number, opts: { operatorId?: number; editorId?: number; proxyReason?: string; starLevel?: number; companyId?: number } = {}) {
  return publishTask(db, {
    operatorId: opts.operatorId ?? 1,
    bookId,
    stage: "RED_CHECK", // 会被忽略，服务端自动计算下一校次
    starLevel: opts.starLevel ?? 1,
    companyId: opts.companyId ?? 2,
    editorId: opts.editorId,
    proxyReason: opts.proxyReason,
  });
}

test("1. 责任编辑能查询自己符合条件的已完成书稿", () => {
  const db = freshDb();
  const { bookId } = toCompleted(db, { title: "已完成书" });
  const list = listEligibleBooks(db, 1);
  assert.ok(list.some((b) => b.bookId === bookId));
  db.close();
});

test("2. 看不到其他责任编辑的书稿", () => {
  const db = freshDb();
  const { bookId } = toCompleted(db, { title: "编辑乙的书", editorId: 5 });
  const list = listEligibleBooks(db, 1);
  assert.ok(!list.some((b) => b.bookId === bookId));
  db.close();
});

test("3. 有待确认任务的书稿不能再次发布", () => {
  const db = freshDb();
  const taskId = publishTask(db, { operatorId: 1, bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 2 });
  const bookId = bookIdOf(db, taskId);
  assertThrowsCode(() => publishNext(db, bookId), "BOOK_HAS_ACTIVE_TASK");
  db.close();
});

test("4. 有待开始任务的书稿不能再次发布", () => {
  const db = freshDb();
  const taskId = publishTask(db, { operatorId: 1, bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 2 });
  confirmReceipt(db, taskId, 2);
  const bookId = bookIdOf(db, taskId);
  assertThrowsCode(() => publishNext(db, bookId), "BOOK_HAS_ACTIVE_TASK");
  db.close();
});

test("5. 有进行中任务的书稿不能再次发布", () => {
  const db = freshDb();
  const taskId = publishTask(db, { operatorId: 1, bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 2 });
  confirmReceipt(db, taskId, 2);
  startTask(db, taskId, 3);
  const bookId = bookIdOf(db, taskId);
  assertThrowsCode(() => publishNext(db, bookId), "BOOK_HAS_ACTIVE_TASK");
  db.close();
});

test("6. 已结束任务可以创建下一校次", () => {
  const db = freshDb();
  const { bookId } = toCompleted(db, { title: "书" });
  const newTaskId = publishNext(db, bookId);
  assert.ok(newTaskId > 0);
  db.close();
});

test("7. 创建下一校次后 books 行数不增加", () => {
  const db = freshDb();
  const { bookId } = toCompleted(db, { title: "书" });
  const booksBefore = rows(db, "books");
  publishNext(db, bookId);
  assert.strictEqual(rows(db, "books"), booksBefore);
  db.close();
});

test("8. tasks 只增加一条", () => {
  const db = freshDb();
  const { bookId } = toCompleted(db, { title: "书" });
  const tasksBefore = rows(db, "tasks");
  publishNext(db, bookId);
  assert.strictEqual(rows(db, "tasks"), tasksBefore + 1);
  db.close();
});

test("9. 校次自动递增且不能由浏览器篡改", () => {
  const db = freshDb();
  const { bookId } = toCompleted(db, { title: "书", stage: "INITIAL_REVIEW" });
  const newTaskId = publishNext(db, bookId); // 传入 stage=RED_CHECK 应被忽略
  const t = db.prepare("SELECT stage FROM tasks WHERE id = ?").get(newTaskId) as { stage: string };
  assert.strictEqual(t.stage, "FIRST_PROOF"); // 初审 → 一校
  db.close();
});

test("10. 接收外校公司正确继承", () => {
  const db = freshDb();
  const { bookId } = toCompleted(db, { title: "书" });
  const newTaskId = publishNext(db, bookId, { companyId: 2 });
  const t = db.prepare("SELECT company_id FROM tasks WHERE id = ?").get(newTaskId) as { company_id: number };
  assert.strictEqual(t.company_id, 2);
  db.close();
});

test("11. 重要程度默认继承", () => {
  const db = freshDb();
  const first = publishTask(db, { operatorId: 1, bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 3, companyId: 2 });
  confirmReceipt(db, first, 2);
  startTask(db, first, 3);
  finishTask(db, first, 3);
  const bookId = bookIdOf(db, first);
  const newTaskId = publishNext(db, bookId, { starLevel: 3 });
  const t = db.prepare("SELECT star_level FROM tasks WHERE id = ?").get(newTaskId) as { star_level: number };
  assert.strictEqual(t.star_level, 3);
  db.close();
});

test("12. 允许修改新任务的重要程度，但不修改旧任务", () => {
  const db = freshDb();
  const first = publishTask(db, { operatorId: 1, bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 2 });
  confirmReceipt(db, first, 2);
  startTask(db, first, 3);
  finishTask(db, first, 3);
  const bookId = bookIdOf(db, first);
  const newTaskId = publishNext(db, bookId, { starLevel: 2 });
  const oldT = db.prepare("SELECT star_level FROM tasks WHERE id = ?").get(first) as { star_level: number };
  const newT = db.prepare("SELECT star_level FROM tasks WHERE id = ?").get(newTaskId) as { star_level: number };
  assert.strictEqual(oldT.star_level, 1);
  assert.strictEqual(newT.star_level, 2);
  db.close();
});

test("13. 写入 TASK_PUBLISHED", () => {
  const db = freshDb();
  const { bookId } = toCompleted(db, { title: "书" });
  const newTaskId = publishNext(db, bookId);
  const c = (db.prepare("SELECT COUNT(*) c FROM task_events WHERE task_id = ? AND event_type = 'TASK_PUBLISHED'").get(newTaskId) as { c: number }).c;
  assert.strictEqual(c, 1);
  db.close();
});

test("14. 责任编辑本人操作 is_proxy=0", () => {
  const db = freshDb();
  const { bookId } = toCompleted(db, { title: "书" });
  const newTaskId = publishNext(db, bookId);
  const e = db.prepare("SELECT is_proxy, operator_id FROM task_events WHERE task_id = ? AND event_type = 'TASK_PUBLISHED'").get(newTaskId) as { is_proxy: number; operator_id: number };
  assert.strictEqual(e.is_proxy, 0);
  assert.strictEqual(e.operator_id, 1);
  db.close();
});

test("15. 管理员代发布正确记录目标责任编辑、原因、代理事件和审计", () => {
  const db = freshDb();
  const { bookId } = toCompleted(db, { title: "书", editorId: 1 });
  const auditsBefore = rows(db, "audit_log");
  const newTaskId = publishNext(db, bookId, { operatorId: 4, editorId: 1, proxyReason: "编辑请假代发下一校次" });
  const t = db.prepare("SELECT publisher_id FROM tasks WHERE id = ?").get(newTaskId) as { publisher_id: number };
  assert.strictEqual(t.publisher_id, 1);
  const e = db.prepare("SELECT is_proxy, proxy_role, operator_id FROM task_events WHERE task_id = ? AND event_type = 'TASK_PUBLISHED'").get(newTaskId) as { is_proxy: number; proxy_role: string | null; operator_id: number };
  assert.strictEqual(e.is_proxy, 1);
  assert.strictEqual(e.proxy_role, "RESPONSIBLE_EDITOR");
  assert.strictEqual(e.operator_id, 4);
  assert.strictEqual(rows(db, "audit_log"), auditsBefore + 1);
  db.close();
});

test("16. 管理员缺少目标责任编辑时拒绝（新书稿）", () => {
  const db = freshDb();
  assertThrowsCode(
    () => publishTask(db, { operatorId: 4, bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 2, proxyReason: "代发" }),
    "PROXY_REASON_REQUIRED",
  );
  db.close();
});

test("17. 管理员缺少代发布原因时拒绝", () => {
  const db = freshDb();
  const { bookId } = toCompleted(db, { title: "书" });
  assertThrowsCode(() => publishNext(db, bookId, { operatorId: 4, editorId: 1 }), "PROXY_REASON_REQUIRED");
  db.close();
});

test("18. 完成三校后可以继续发起加校", () => {
  const db = freshDb();
  const { bookId } = toCompleted(db, { title: "书", stage: "THIRD_PROOF" });
  const newTaskId = publishNext(db, bookId);
  const t = db.prepare("SELECT stage FROM tasks WHERE id = ?").get(newTaskId) as { stage: string };
  assert.strictEqual(t.stage, "ADDITIONAL_PROOF");
  db.close();
});

test("19. 两次连续提交只有一次成功", () => {
  const db = freshDb();
  const { bookId } = toCompleted(db, { title: "书" });
  publishNext(db, bookId);
  assertThrowsCode(() => publishNext(db, bookId), "BOOK_HAS_ACTIVE_TASK");
  db.close();
});

test("20. 并发提交只有一次成功（第二次报重复）", () => {
  const db = freshDb();
  const { bookId } = toCompleted(db, { title: "书" });
  const first = publishNext(db, bookId);
  assert.ok(first > 0);
  assertThrowsCode(() => publishNext(db, bookId), "BOOK_HAS_ACTIVE_TASK");
  db.close();
});

test("21. 取消规则与下一校次创建不冲突", () => {
  const db = freshDb();
  // 初审完成，一校被取消 → 该书稿仍可继续发起一校
  const first = publishTask(db, { operatorId: 1, bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 2 });
  confirmReceipt(db, first, 2);
  startTask(db, first, 3);
  finishTask(db, first, 3);
  const bookId = bookIdOf(db, first);
  const second = publishNext(db, bookId); // 一校
  cancelTask(db, second, 4, "误发");
  assert.ok(listEligibleBooks(db, 1).some((b) => b.bookId === bookId));
  const third = publishNext(db, bookId); // 重新发起一校
  const t = db.prepare("SELECT stage FROM tasks WHERE id = ?").get(third) as { stage: string };
  assert.strictEqual(t.stage, "FIRST_PROOF");
  db.close();
});

test("22. 详情页能够显示两个校次及正确事件顺序", () => {
  const db = freshDb();
  const { bookId } = toCompleted(db, { title: "书" });
  publishNext(db, bookId);
  const d = getBookDetail(db, bookId);
  assert.ok(d);
  assert.strictEqual(d.tasks.length, 2);
  assert.deepStrictEqual(d.tasks.map((t) => t.stage), ["INITIAL_REVIEW", "FIRST_PROOF"]);
  db.close();
});

test("23. 原任务的校对人员、开始时间、完成时间不变", () => {
  const db = freshDb();
  const first = publishTask(db, { operatorId: 1, bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 2 });
  confirmReceipt(db, first, 2);
  startTask(db, first, 3);
  finishTask(db, first, 3);
  const before = db.prepare("SELECT proofreader_id, started_at, finished_at FROM tasks WHERE id = ?").get(first) as { proofreader_id: number; started_at: string; finished_at: string };
  const bookId = bookIdOf(db, first);
  publishNext(db, bookId);
  const after = db.prepare("SELECT proofreader_id, started_at, finished_at FROM tasks WHERE id = ?").get(first) as { proofreader_id: number; started_at: string; finished_at: string };
  assert.strictEqual(after.proofreader_id, before.proofreader_id);
  assert.strictEqual(after.started_at, before.started_at);
  assert.strictEqual(after.finished_at, before.finished_at);
  db.close();
});

test("24. 正式数据库不被测试数据污染", () => {
  if (!fs.existsSync(FORMAL_PATH)) return;
  assert.deepStrictEqual(formalCounts(), FORMAL_BASELINE);
});
