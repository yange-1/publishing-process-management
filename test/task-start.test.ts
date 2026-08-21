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
  TaskServiceError,
  type TaskErrorCode,
} from "../lib/task-service.ts";

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
      (3, 'pf1', '校对甲', 'PROOFREADER', 2, 1, 0),
      (4, 'admin1', '管理员', 'INTERNAL_ADMIN', 1, 1, 0),
      (5, 'pf2', '校对乙', 'PROOFREADER', 2, 1, 0),
      (6, 'pf3', '校对丙', 'PROOFREADER', 3, 1, 0),
      (7, 'pfInactive', '停用校对', 'PROOFREADER', 2, 0, 0),
      (8, 'pfMustChange', '未改密校对', 'PROOFREADER', 2, 1, 1)`,
  ).run();
  return db;
}

function publish(
  db: Database.Database,
  opts: { title?: string; companyId?: number } = {},
): number {
  return publishTask(db, {
    operatorId: 1,
    bookTitle: opts.title ?? "书",
    stage: "INITIAL_REVIEW",
    starLevel: 1,
    companyId: opts.companyId ?? 2,
  });
}

function toReady(db: Database.Database, opts: { title?: string; companyId?: number } = {}): number {
  const id = publish(db, opts);
  if (opts.companyId === 3) {
    db.prepare("UPDATE tasks SET status = 'READY_TO_START', confirm_company_id = 3 WHERE id = ?").run(id);
  } else {
    confirmReceipt(db, id, 2);
  }
  return id;
}

function rows(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c;
}

function status(db: Database.Database, taskId: number): string {
  return (db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as { status: string }).status;
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

test("1. 校对人员成功开始本公司任务", () => {
  const db = freshDb();
  const taskId = toReady(db);
  startTask(db, taskId, 3);
  assert.strictEqual(status(db, taskId), "IN_PROGRESS");
  db.close();
});

test("2. 状态从READY_TO_START变为IN_PROGRESS", () => {
  const db = freshDb();
  const taskId = toReady(db);
  assert.strictEqual(status(db, taskId), "READY_TO_START");
  startTask(db, taskId, 3);
  assert.strictEqual(status(db, taskId), "IN_PROGRESS");
  db.close();
});

test("3. 自动写入proofreader_id和started_at", () => {
  const db = freshDb();
  const taskId = toReady(db);
  startTask(db, taskId, 3);
  const t = db.prepare("SELECT proofreader_id, started_at FROM tasks WHERE id = ?").get(taskId) as { proofreader_id: number; started_at: string };
  assert.strictEqual(t.proofreader_id, 3);
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(t.started_at));
  db.close();
});

test("4. 追加一条TASK_STARTED", () => {
  const db = freshDb();
  const taskId = toReady(db);
  startTask(db, taskId, 3);
  const c = (db.prepare("SELECT COUNT(*) c FROM task_events WHERE task_id = ? AND event_type = 'TASK_STARTED'").get(taskId) as { c: number }).c;
  assert.strictEqual(c, 1);
  db.close();
});

test("5. 本人操作is_proxy=0", () => {
  const db = freshDb();
  const taskId = toReady(db);
  startTask(db, taskId, 3);
  const e = db.prepare("SELECT is_proxy, operator_id FROM task_events WHERE task_id = ? AND event_type = 'TASK_STARTED'").get(taskId) as { is_proxy: number; operator_id: number };
  assert.strictEqual(e.is_proxy, 0);
  assert.strictEqual(e.operator_id, 3);
  db.close();
});

test("6. 本人操作不写audit_log", () => {
  const db = freshDb();
  const taskId = toReady(db);
  const before = rows(db, "audit_log");
  startTask(db, taskId, 3);
  assert.strictEqual(rows(db, "audit_log"), before);
  db.close();
});

test("7. 责任编辑无权开始", () => {
  const db = freshDb();
  const taskId = toReady(db);
  assertThrowsCode(() => startTask(db, taskId, 1), "FORBIDDEN");
  db.close();
});

test("8. 外校主管无权开始", () => {
  const db = freshDb();
  const taskId = toReady(db);
  assertThrowsCode(() => startTask(db, taskId, 2), "FORBIDDEN");
  db.close();
});

test("9. 校对人员不能开始其他公司的任务", () => {
  const db = freshDb();
  const taskId = toReady(db, { companyId: 3 });
  assertThrowsCode(() => startTask(db, taskId, 3), "FORBIDDEN");
  db.close();
});

test("10. PENDING_CONFIRMATION不能开始", () => {
  const db = freshDb();
  const taskId = publish(db);
  assertThrowsCode(() => startTask(db, taskId, 3), "INVALID_STATUS");
  db.close();
});

test("11. IN_PROGRESS不能重复开始", () => {
  const db = freshDb();
  const taskId = toReady(db);
  startTask(db, taskId, 3);
  assertThrowsCode(() => startTask(db, taskId, 3), "TASK_ALREADY_STARTED");
  db.close();
});

test("12. COMPLETED不能重新开始", () => {
  const db = freshDb();
  const taskId = toReady(db);
  startTask(db, taskId, 3);
  finishTask(db, taskId, 3);
  assertThrowsCode(() => startTask(db, taskId, 3), "INVALID_STATUS");
  db.close();
});

test("13. 已停用校对人员不能开始", () => {
  const db = freshDb();
  const taskId = toReady(db);
  assertThrowsCode(() => startTask(db, taskId, 7), "USER_INACTIVE");
  db.close();
});

test("14. 未完成首次改密的账号不能开始", () => {
  const db = freshDb();
  const taskId = toReady(db);
  assertThrowsCode(() => startTask(db, taskId, 8), "MUST_CHANGE_PASSWORD");
  db.close();
});

test("15. 校对人员已有进行中任务时不能开始第二本", () => {
  const db = freshDb();
  const a = toReady(db, { title: "A" });
  const b = toReady(db, { title: "B" });
  startTask(db, a, 3);
  assertThrowsCode(() => startTask(db, b, 3), "PROOFREADER_BUSY");
  db.close();
});

test("16. 两人同时抢同一任务只有一人成功", () => {
  const db = freshDb();
  const taskId = toReady(db);
  startTask(db, taskId, 3);
  assertThrowsCode(() => startTask(db, taskId, 5), "TASK_ALREADY_STARTED");
  const t = db.prepare("SELECT proofreader_id FROM tasks WHERE id = ?").get(taskId) as { proofreader_id: number };
  assert.strictEqual(t.proofreader_id, 3);
  db.close();
});

test("17. 同一人同时开始两个任务只有一个成功", () => {
  const db = freshDb();
  const a = toReady(db, { title: "A" });
  const b = toReady(db, { title: "B" });
  startTask(db, a, 3);
  assertThrowsCode(() => startTask(db, b, 3), "PROOFREADER_BUSY");
  assert.strictEqual(status(db, a), "IN_PROGRESS");
  assert.strictEqual(status(db, b), "READY_TO_START");
  db.close();
});

test("18. 失败事务不产生残缺事件", () => {
  const db = freshDb();
  const taskId = publish(db); // PENDING
  const eventsBefore = rows(db, "task_events");
  assertThrowsCode(() => startTask(db, taskId, 3), "INVALID_STATUS");
  assert.strictEqual(status(db, taskId), "PENDING_CONFIRMATION");
  assert.strictEqual(rows(db, "task_events"), eventsBefore);
  db.close();
});

test("19. 管理员可以代开始", () => {
  const db = freshDb();
  const taskId = toReady(db);
  startTask(db, taskId, 4, { proofreaderId: 3, proxyReason: "主管请假代开始" });
  assert.strictEqual(status(db, taskId), "IN_PROGRESS");
  const t = db.prepare("SELECT proofreader_id FROM tasks WHERE id = ?").get(taskId) as { proofreader_id: number };
  assert.strictEqual(t.proofreader_id, 3);
  db.close();
});

test("20. 管理员代开始必须提供原因", () => {
  const db = freshDb();
  const taskId = toReady(db);
  assertThrowsCode(() => startTask(db, taskId, 4, { proofreaderId: 3 }), "PROXY_REASON_REQUIRED");
  db.close();
});

test("21. 管理员代开始只能选择正确公司的有效校对人员", () => {
  const db = freshDb();
  const taskId = toReady(db);
  // 其他公司的校对人员
  assertThrowsCode(() => startTask(db, taskId, 4, { proofreaderId: 6, proxyReason: "代开始" }), "USER_NOT_FOUND");
  // 停用的校对人员
  assertThrowsCode(() => startTask(db, taskId, 4, { proofreaderId: 7, proxyReason: "代开始" }), "USER_NOT_FOUND");
  db.close();
});

test("22. 管理员代开始写is_proxy=1、proxy_role和审计记录", () => {
  const db = freshDb();
  const taskId = toReady(db);
  const auditsBefore = rows(db, "audit_log");
  startTask(db, taskId, 4, { proofreaderId: 3, proxyReason: "主管请假代开始" });
  const e = db.prepare("SELECT is_proxy, proxy_role, operator_id FROM task_events WHERE task_id = ? AND event_type = 'TASK_STARTED'").get(taskId) as { is_proxy: number; proxy_role: string | null; operator_id: number };
  assert.strictEqual(e.is_proxy, 1);
  assert.strictEqual(e.proxy_role, "PROOFREADER");
  assert.strictEqual(e.operator_id, 4);
  assert.strictEqual(rows(db, "audit_log"), auditsBefore + 1);
  const audit = db.prepare("SELECT operation_type, operator_id, reason FROM audit_log WHERE target_id = ? AND operation_type = 'PROXY_START'").get(String(taskId)) as { operation_type: string; operator_id: number; reason: string };
  assert.strictEqual(audit.operation_type, "PROXY_START");
  assert.strictEqual(audit.operator_id, 4);
  assert.strictEqual(audit.reason, "主管请假代开始");
  db.close();
});

test("23. 数据库一人一书部分唯一索引继续有效", () => {
  const db = freshDb();
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_tasks_one_active_per_proofreader'").get();
  assert.ok(idx);
  const a = toReady(db, { title: "A" });
  const b = toReady(db, { title: "B" });
  startTask(db, a, 3);
  assert.throws(() => db.prepare("UPDATE tasks SET status = 'IN_PROGRESS', proofreader_id = 3 WHERE id = ?").run(b));
  db.close();
});

test("24. 正式数据库不被测试污染", () => {
  if (!fs.existsSync(FORMAL_PATH)) return;
  assert.deepStrictEqual(formalCounts(), FORMAL_BASELINE);
});
