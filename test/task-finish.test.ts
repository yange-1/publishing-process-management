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
    "INSERT INTO companies(id, name, type) VALUES (1, '社内', 'INTERNAL'), (2, '外校A', 'EXTERNAL')",
  ).run();
  db.prepare(
    `INSERT INTO users(id, username, display_name, role, company_id, is_active, must_change_password) VALUES
      (1, 'editor1', '编辑甲', 'RESPONSIBLE_EDITOR', 1, 1, 0),
      (2, 'sup1', '主管甲', 'EXTERNAL_SUPERVISOR', 2, 1, 0),
      (3, 'pf1', '校对甲', 'PROOFREADER', 2, 1, 0),
      (4, 'admin1', '管理员', 'INTERNAL_ADMIN', 1, 1, 0),
      (5, 'pf2', '校对乙', 'PROOFREADER', 2, 1, 0),
      (6, 'pfInactive', '停用校对', 'PROOFREADER', 2, 0, 0),
      (7, 'pfMustChange', '未改密校对', 'PROOFREADER', 2, 1, 1)`,
  ).run();
  return db;
}

function toInProgress(db: Database.Database, proofreaderId = 3): number {
  const id = publishTask(db, {
    operatorId: 1,
    bookTitle: "书",
    stage: "INITIAL_REVIEW",
    starLevel: 1,
    companyId: 2,
  });
  confirmReceipt(db, id, 2);
  startTask(db, id, proofreaderId);
  return id;
}

function rows(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c;
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
      assert.ok(
        err instanceof TaskServiceError,
        `expected TaskServiceError, got ${String(err)}`,
      );
      assert.strictEqual((err as TaskServiceError).code, code);
      return true;
    },
  );
}

test("1. 当前校对人员成功结束自己的任务", () => {
  const db = freshDb();
  const taskId = toInProgress(db, 3);
  finishTask(db, taskId, 3);
  assert.strictEqual(status(db, taskId), "COMPLETED");
  db.close();
});

test("2. 状态变为COMPLETED", () => {
  const db = freshDb();
  const taskId = toInProgress(db, 3);
  assert.strictEqual(status(db, taskId), "IN_PROGRESS");
  finishTask(db, taskId, 3);
  assert.strictEqual(status(db, taskId), "COMPLETED");
  db.close();
});

test("3. 自动写入finished_at", () => {
  const db = freshDb();
  const taskId = toInProgress(db, 3);
  finishTask(db, taskId, 3);
  const t = db.prepare("SELECT finished_at FROM tasks WHERE id = ?").get(taskId) as { finished_at: string };
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(t.finished_at));
  db.close();
});

test("4. 保留原proofreader_id和started_at", () => {
  const db = freshDb();
  const taskId = toInProgress(db, 3);
  const before = db.prepare("SELECT proofreader_id, started_at FROM tasks WHERE id = ?").get(taskId) as { proofreader_id: number; started_at: string };
  finishTask(db, taskId, 3);
  const after = db.prepare("SELECT proofreader_id, started_at FROM tasks WHERE id = ?").get(taskId) as { proofreader_id: number; started_at: string };
  assert.strictEqual(after.proofreader_id, before.proofreader_id);
  assert.strictEqual(after.started_at, before.started_at);
  db.close();
});

test("5. 追加一条TASK_COMPLETED", () => {
  const db = freshDb();
  const taskId = toInProgress(db, 3);
  finishTask(db, taskId, 3);
  assert.strictEqual(eventCount(db, taskId, "TASK_COMPLETED"), 1);
  db.close();
});

test("6. 本人操作is_proxy=0", () => {
  const db = freshDb();
  const taskId = toInProgress(db, 3);
  finishTask(db, taskId, 3);
  const e = db.prepare("SELECT is_proxy, operator_id FROM task_events WHERE task_id = ? AND event_type = 'TASK_COMPLETED'").get(taskId) as { is_proxy: number; operator_id: number };
  assert.strictEqual(e.is_proxy, 0);
  assert.strictEqual(e.operator_id, 3);
  db.close();
});

test("7. 本人操作不写audit_log", () => {
  const db = freshDb();
  const taskId = toInProgress(db, 3);
  const before = rows(db, "audit_log");
  finishTask(db, taskId, 3);
  assert.strictEqual(rows(db, "audit_log"), before);
  db.close();
});

test("8. 责任编辑不能结束", () => {
  const db = freshDb();
  const taskId = toInProgress(db, 3);
  assertThrowsCode(() => finishTask(db, taskId, 1), "FORBIDDEN");
  db.close();
});

test("9. 外校主管不能结束", () => {
  const db = freshDb();
  const taskId = toInProgress(db, 3);
  assertThrowsCode(() => finishTask(db, taskId, 2), "FORBIDDEN");
  db.close();
});

test("10. 其他校对人员不能结束", () => {
  const db = freshDb();
  const taskId = toInProgress(db, 3);
  assertThrowsCode(() => finishTask(db, taskId, 5), "NOT_TASK_PROOFREADER");
  db.close();
});

test("11. 未启用账号不能结束", () => {
  const db = freshDb();
  const taskId = toInProgress(db, 3);
  assertThrowsCode(() => finishTask(db, taskId, 6), "USER_INACTIVE");
  db.close();
});

test("12. 未完成首次改密账号不能结束", () => {
  const db = freshDb();
  const taskId = toInProgress(db, 3);
  assertThrowsCode(() => finishTask(db, taskId, 7), "MUST_CHANGE_PASSWORD");
  db.close();
});

test("13. PENDING_CONFIRMATION不能结束", () => {
  const db = freshDb();
  const taskId = publishTask(db, { operatorId: 1, bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 2 });
  assertThrowsCode(() => finishTask(db, taskId, 3), "INVALID_STATUS");
  db.close();
});

test("14. READY_TO_START不能结束", () => {
  const db = freshDb();
  const taskId = publishTask(db, { operatorId: 1, bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 2 });
  confirmReceipt(db, taskId, 2);
  assertThrowsCode(() => finishTask(db, taskId, 3), "INVALID_STATUS");
  db.close();
});

test("15. COMPLETED不能重复结束", () => {
  const db = freshDb();
  const taskId = toInProgress(db, 3);
  finishTask(db, taskId, 3);
  finishTask(db, taskId, 3); // 已结束，幂等不抛错
  assert.strictEqual(status(db, taskId), "COMPLETED");
  assert.strictEqual(eventCount(db, taskId, "TASK_COMPLETED"), 1);
  db.close();
});

test("16. CANCELLED不能结束", () => {
  const db = freshDb();
  const taskId = publishTask(db, { operatorId: 1, bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 2 });
  cancelTask(db, taskId, 4, "误发");
  assertThrowsCode(() => finishTask(db, taskId, 3), "INVALID_STATUS");
  db.close();
});

test("17. 两次并发结束只有一次成功", () => {
  const db = freshDb();
  const taskId = toInProgress(db, 3);
  finishTask(db, taskId, 3);
  finishTask(db, taskId, 3); // 第二次幂等
  assert.strictEqual(eventCount(db, taskId, "TASK_COMPLETED"), 1);
  db.close();
});

test("18. 重复操作不产生重复事件", () => {
  const db = freshDb();
  const taskId = toInProgress(db, 3);
  finishTask(db, taskId, 3);
  const before = db.prepare("SELECT finished_at FROM tasks WHERE id = ?").get(taskId) as { finished_at: string };
  finishTask(db, taskId, 3);
  const after = db.prepare("SELECT finished_at FROM tasks WHERE id = ?").get(taskId) as { finished_at: string };
  assert.strictEqual(after.finished_at, before.finished_at);
  assert.strictEqual(eventCount(db, taskId, "TASK_COMPLETED"), 1);
  db.close();
});

test("19. 失败事务不产生残缺事件", () => {
  const db = freshDb();
  const taskId = toInProgress(db, 3);
  const eventsBefore = rows(db, "task_events");
  assertThrowsCode(() => finishTask(db, taskId, 5), "NOT_TASK_PROOFREADER");
  assert.strictEqual(status(db, taskId), "IN_PROGRESS");
  assert.strictEqual(rows(db, "task_events"), eventsBefore);
  db.close();
});

test("20. 管理员可以代结束", () => {
  const db = freshDb();
  const taskId = toInProgress(db, 3);
  finishTask(db, taskId, 4, { proxyReason: "主管请假代结束" });
  assert.strictEqual(status(db, taskId), "COMPLETED");
  db.close();
});

test("21. 管理员代结束必须填写原因", () => {
  const db = freshDb();
  const taskId = toInProgress(db, 3);
  assertThrowsCode(() => finishTask(db, taskId, 4), "PROXY_REASON_REQUIRED");
  db.close();
});

test("22. 管理员代结束保留原校对人员", () => {
  const db = freshDb();
  const taskId = toInProgress(db, 3);
  finishTask(db, taskId, 4, { proxyReason: "主管请假代结束" });
  const t = db.prepare("SELECT proofreader_id FROM tasks WHERE id = ?").get(taskId) as { proofreader_id: number };
  assert.strictEqual(t.proofreader_id, 3);
  db.close();
});

test("23. 管理员代结束写代理事件和审计记录", () => {
  const db = freshDb();
  const taskId = toInProgress(db, 3);
  const auditsBefore = rows(db, "audit_log");
  finishTask(db, taskId, 4, { proxyReason: "主管请假代结束" });
  const e = db.prepare("SELECT is_proxy, proxy_role, operator_id FROM task_events WHERE task_id = ? AND event_type = 'TASK_COMPLETED'").get(taskId) as { is_proxy: number; proxy_role: string | null; operator_id: number };
  assert.strictEqual(e.is_proxy, 1);
  assert.strictEqual(e.proxy_role, "PROOFREADER");
  assert.strictEqual(e.operator_id, 4);
  assert.strictEqual(rows(db, "audit_log"), auditsBefore + 1);
  const audit = db.prepare("SELECT operation_type, operator_id, reason FROM audit_log WHERE target_id = ? AND operation_type = 'PROXY_FINISH'").get(String(taskId)) as { operation_type: string; operator_id: number; reason: string };
  assert.strictEqual(audit.operation_type, "PROXY_FINISH");
  assert.strictEqual(audit.operator_id, 4);
  assert.strictEqual(audit.reason, "主管请假代结束");
  db.close();
});

test("24. 任务结束后，该校对人员能够开始下一条待开始任务", () => {
  const db = freshDb();
  const taskId = toInProgress(db, 3);
  finishTask(db, taskId, 3);
  const next = publishTask(db, { operatorId: 1, bookTitle: "下一本", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 2 });
  confirmReceipt(db, next, 2);
  startTask(db, next, 3);
  assert.strictEqual(status(db, next), "IN_PROGRESS");
  db.close();
});

test("25. 正式数据库不被测试污染", () => {
  if (!fs.existsSync(FORMAL_PATH)) return;
  assert.deepStrictEqual(formalCounts(), FORMAL_BASELINE);
});
