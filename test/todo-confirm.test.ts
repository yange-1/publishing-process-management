import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  publishTask,
  confirmReceipt,
  countPendingConfirmation,
  TaskServiceError,
  type TaskErrorCode,
} from "../lib/task-service.ts";
import { listWarehouse } from "../lib/dashboard-service.ts";
import { listMyTodos, type TodoUser } from "../lib/todo-service.ts";

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
    `INSERT INTO users(id, username, display_name, role, company_id, is_active, must_change_password) VALUES
      (1, 'editor1', '编辑甲', 'RESPONSIBLE_EDITOR', 1, 1, 0),
      (2, 'sup1', '主管甲', 'EXTERNAL_SUPERVISOR', 2, 1, 0),
      (3, 'sup2', '主管乙', 'EXTERNAL_SUPERVISOR', 3, 1, 0),
      (4, 'pf1', '校对甲', 'PROOFREADER', 2, 1, 0),
      (5, 'admin1', '管理员', 'INTERNAL_ADMIN', 1, 1, 0)`,
  ).run();
  return db;
}

const SUP1: TodoUser = { id: 2, role: "EXTERNAL_SUPERVISOR", companyId: 2 };

function publish(
  db: Database.Database,
  opts: { title?: string; stage?: string; starLevel?: number; companyId?: number } = {},
): number {
  return publishTask(db, {
    operatorId: 1,
    bookTitle: opts.title ?? "书",
    stage: opts.stage ?? "INITIAL_REVIEW",
    starLevel: opts.starLevel ?? 1,
    companyId: opts.companyId ?? 2,
  });
}

function status(db: Database.Database, taskId: number): string {
  return (db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as { status: string }).status;
}

function eventCount(db: Database.Database, taskId: number, type?: string): number {
  return type
    ? (db.prepare("SELECT COUNT(*) c FROM task_events WHERE task_id = ? AND event_type = ?").get(taskId, type) as { c: number }).c
    : (db.prepare("SELECT COUNT(*) c FROM task_events WHERE task_id = ?").get(taskId) as { c: number }).c;
}

function assertThrowsCode(fn: () => unknown, code: TaskErrorCode): void {
  assert.throws(
    fn,
    (err: unknown) => {
      assert.ok(err instanceof TaskServiceError, `expected TaskServiceError, got ${String(err)}`);
      assert.strictEqual((err as TaskServiceError).code, code);
      return true;
    },
  );
}

test("1. 外校主管待办含本公司待确认任务并可确认", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  const s = listMyTodos(db, SUP1);
  assert.deepStrictEqual(s.items.map((i) => i.id), [taskId]);
  assert.strictEqual(s.items[0].status, "PENDING_CONFIRMATION");
  assert.strictEqual(confirmReceipt(db, taskId, 2), "confirmed");
  db.close();
});

test("2. 确认后状态变为 READY_TO_START", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  confirmReceipt(db, taskId, 2);
  assert.strictEqual(status(db, taskId), "READY_TO_START");
  db.close();
});

test("3. 确认后自动写入一条 RECEIPT_CONFIRMED 事件", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  confirmReceipt(db, taskId, 2);
  assert.strictEqual(eventCount(db, taskId, "RECEIPT_CONFIRMED"), 1);
  db.close();
});

test("4. 操作人、公司、时间均由服务端确定", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  confirmReceipt(db, taskId, 2);
  const t = db
    .prepare("SELECT confirmer_id, confirm_company_id, confirmed_at FROM tasks WHERE id = ?")
    .get(taskId) as { confirmer_id: number; confirm_company_id: number; confirmed_at: string };
  assert.strictEqual(t.confirmer_id, 2); // 当前外校主管
  assert.strictEqual(t.confirm_company_id, 2); // 主管所属公司
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(t.confirmed_at)); // 服务器时间
  const e = db
    .prepare("SELECT operator_id, is_proxy FROM task_events WHERE task_id = ? AND event_type = 'RECEIPT_CONFIRMED'")
    .get(taskId) as { operator_id: number; is_proxy: number };
  assert.strictEqual(e.operator_id, 2);
  assert.strictEqual(e.is_proxy, 0);
  db.close();
});

test("5. 确认后任务从外校主管待办列表消失", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  assert.deepStrictEqual(listMyTodos(db, SUP1).items.map((i) => i.id), [taskId]);
  confirmReceipt(db, taskId, 2);
  assert.deepStrictEqual(listMyTodos(db, SUP1).items, []);
  db.close();
});

test("6. 确认后待办 activeCount 减 1", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  assert.strictEqual(listMyTodos(db, SUP1).activeCount, 1);
  confirmReceipt(db, taskId, 2);
  assert.strictEqual(listMyTodos(db, SUP1).activeCount, 0);
  db.close();
});

test("7. 确认后待确认收稿数量减 1、任务进入书稿仓库为待开始", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  const pendingBefore = countPendingConfirmation(db);
  confirmReceipt(db, taskId, 2);
  assert.strictEqual(countPendingConfirmation(db), pendingBefore - 1);
  const w = listWarehouse(db);
  assert.deepStrictEqual(w.map((t) => t.id), [taskId]);
  assert.strictEqual(w[0].status, "READY_TO_START");
  db.close();
});

test("8. 非本公司外校主管无权确认", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  assertThrowsCode(() => confirmReceipt(db, taskId, 3), "FORBIDDEN");
  db.close();
});

test("9. 责任编辑、校对人员无权确认", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  assertThrowsCode(() => confirmReceipt(db, taskId, 1), "FORBIDDEN");
  assertThrowsCode(() => confirmReceipt(db, taskId, 4), "FORBIDDEN");
  db.close();
});

test("10. 重复确认只成功一次、不重复写事件", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  assert.strictEqual(confirmReceipt(db, taskId, 2), "confirmed");
  assert.strictEqual(confirmReceipt(db, taskId, 2), "already_confirmed");
  assert.strictEqual(eventCount(db, taskId, "RECEIPT_CONFIRMED"), 1);
  db.close();
});

test("11. 已取消/待开始/进行中/已结束任务不能再次确认", () => {
  const db = freshDb();
  // 已取消
  const cancelled = publish(db, { companyId: 2 });
  db.prepare("UPDATE tasks SET status = 'CANCELLED' WHERE id = ?").run(cancelled);
  assertThrowsCode(() => confirmReceipt(db, cancelled, 2), "INVALID_STATUS");
  // 待开始（已确认过，幂等返回 already_confirmed，不重复写事件）
  const ready = publish(db, { companyId: 2 });
  confirmReceipt(db, ready, 2);
  assert.strictEqual(confirmReceipt(db, ready, 2), "already_confirmed");
  assert.strictEqual(eventCount(db, ready, "RECEIPT_CONFIRMED"), 1);
  // 进行中
  const inprog = publish(db, { companyId: 2 });
  confirmReceipt(db, inprog, 2);
  db.prepare("UPDATE tasks SET status = 'IN_PROGRESS' WHERE id = ?").run(inprog);
  assertThrowsCode(() => confirmReceipt(db, inprog, 2), "INVALID_STATUS");
  // 已结束
  const done = publish(db, { companyId: 2 });
  confirmReceipt(db, done, 2);
  db.prepare("UPDATE tasks SET status = 'COMPLETED' WHERE id = ?").run(done);
  assertThrowsCode(() => confirmReceipt(db, done, 2), "INVALID_STATUS");
  db.close();
});

test("12. 源码：我的待办复用 confirmReceiptAction，服务端回查角色", () => {
  const todoList = fs.readFileSync(
    path.join(process.cwd(), "app", "tasks", "my-todos", "TodoList.tsx"),
    "utf-8",
  );
  assert.ok(todoList.includes("confirmReceiptAction"));
  assert.ok(todoList.includes("确认收稿"));
  assert.ok(!todoList.includes("UPDATE tasks"));

  const page = fs.readFileSync(
    path.join(process.cwd(), "app", "tasks", "my-todos", "page.tsx"),
    "utf-8",
  );
  assert.ok(page.includes("requireCurrentUser"));

  const action = fs.readFileSync(
    path.join(process.cwd(), "app", "tasks", "pending-confirmation", "actions.ts"),
    "utf-8",
  );
  assert.ok(action.includes("getCurrentUser"));
  assert.ok(!action.includes("input.role"));
  assert.ok(!action.includes("input.companyId"));
  assert.ok(!action.includes("input.confirmedAt"));
});

test("13. 待办确认测试不污染正式数据库", () => {
  if (!fs.existsSync(FORMAL_PATH)) return;
  assert.deepStrictEqual(formalCounts(), FORMAL_BASELINE);
});
