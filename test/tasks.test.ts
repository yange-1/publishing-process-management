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

const FORMAL_TABLES = ["companies", "users", "books", "tasks", "task_events", "audit_log"];
const FORMAL_PATH = path.join(process.cwd(), "data", "publishing-process.db");

function formalCounts(): Record<string, number> {
  const r: Record<string, number> = {};
  if (!fs.existsSync(FORMAL_PATH)) return r;
  const db = new Database(FORMAL_PATH, { readonly: true });
  for (const t of FORMAL_TABLES) {
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
      (2, 'editor2', '编辑乙', 'RESPONSIBLE_EDITOR', 1),
      (3, 'sup1', '主管甲', 'EXTERNAL_SUPERVISOR', 2),
      (4, 'pf1', '校对甲', 'PROOFREADER', 2),
      (5, 'pf2', '校对乙', 'PROOFREADER', 2),
      (6, 'admin1', '管理员', 'INTERNAL_ADMIN', 1),
      (7, 'inactive', '停用编辑', 'RESPONSIBLE_EDITOR', 1)`,
  ).run();
  db.prepare("UPDATE users SET is_active = 0 WHERE id = 7").run();
  return db;
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

function eventCount(db: Database.Database, taskId: number, type?: string): number {
  return type
    ? (db.prepare("SELECT COUNT(*) c FROM task_events WHERE task_id = ? AND event_type = ?").get(taskId, type) as { c: number }).c
    : (db.prepare("SELECT COUNT(*) c FROM task_events WHERE task_id = ?").get(taskId) as { c: number }).c;
}

function auditCount(db: Database.Database): number {
  return (db.prepare("SELECT COUNT(*) c FROM audit_log").get() as { c: number }).c;
}

function status(db: Database.Database, taskId: number): string {
  return (db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as { status: string }).status;
}

function publishThenConfirmThenStart(db: Database.Database): number {
  const taskId = publishTask(db, {
    operatorId: 1,
    bookTitle: "测试图书A",
    stage: "FIRST_PROOF",
    starLevel: 2,
  });
  confirmReceipt(db, taskId, 3); // 外校主管确认
  startTask(db, taskId, 4); // 校对甲开始
  return taskId;
}

test("1. 责任编辑发布成功，生成任务和一条发布事件", () => {
  const db = freshDb();
  const taskId = publishTask(db, {
    operatorId: 1,
    bookTitle: "测试图书A",
    stage: "INITIAL_REVIEW",
    starLevel: 1,
  });
  assert.ok(taskId > 0);
  assert.strictEqual(status(db, taskId), "PENDING_CONFIRMATION");
  assert.strictEqual(eventCount(db, taskId), 1);
  assert.strictEqual(eventCount(db, taskId, "TASK_PUBLISHED"), 1);
  const task = db.prepare("SELECT publisher_id, published_at FROM tasks WHERE id = ?").get(taskId) as { publisher_id: number; published_at: string };
  assert.strictEqual(task.publisher_id, 1);
  assert.ok(task.published_at && /^\d{4}-\d{2}-\d{2}T/.test(task.published_at));
  db.close();
});

test("2. 无权限用户不能发布", () => {
  const db = freshDb();
  assertThrowsCode(
    () => publishTask(db, { operatorId: 4, bookTitle: "x", stage: "INITIAL_REVIEW", starLevel: 1 }),
    "FORBIDDEN",
  );
  db.close();
});

test("3. 超级管理员代发布生成审计记录", () => {
  const db = freshDb();
  const before = auditCount(db);
  const taskId = publishTask(db, {
    operatorId: 6,
    editorId: 1,
    proxyReason: "编辑请假代发",
    bookTitle: "测试图书B",
    stage: "INITIAL_REVIEW",
    starLevel: 1,
  });
  assert.ok(taskId > 0);
  assert.strictEqual(auditCount(db), before + 1);
  const task = db.prepare("SELECT publisher_id FROM tasks WHERE id = ?").get(taskId) as { publisher_id: number };
  assert.strictEqual(task.publisher_id, 1); // 责任编辑为编辑甲
  db.close();
});

test("4. 外校主管确认成功", () => {
  const db = freshDb();
  const taskId = publishTask(db, { operatorId: 1, bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 1 });
  confirmReceipt(db, taskId, 3);
  assert.strictEqual(status(db, taskId), "READY_TO_START");
  assert.strictEqual(eventCount(db, taskId, "RECEIPT_CONFIRMED"), 1);
  const task = db.prepare("SELECT confirmer_id, confirm_company_id, confirmed_at FROM tasks WHERE id = ?").get(taskId) as { confirmer_id: number; confirm_company_id: number; confirmed_at: string };
  assert.strictEqual(task.confirmer_id, 3);
  assert.strictEqual(task.confirm_company_id, 2);
  assert.ok(task.confirmed_at);
  db.close();
});

test("5. 重复确认不生成重复事件", () => {
  const db = freshDb();
  const taskId = publishTask(db, { operatorId: 1, bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 1 });
  confirmReceipt(db, taskId, 3);
  const confirmer = db.prepare("SELECT confirmer_id, confirmed_at FROM tasks WHERE id = ?").get(taskId) as { confirmer_id: number; confirmed_at: string };
  confirmReceipt(db, taskId, 3); // 重复确认
  assert.strictEqual(eventCount(db, taskId, "RECEIPT_CONFIRMED"), 1);
  const after = db.prepare("SELECT confirmer_id, confirmed_at FROM tasks WHERE id = ?").get(taskId) as { confirmer_id: number; confirmed_at: string };
  assert.strictEqual(after.confirmer_id, confirmer.confirmer_id);
  assert.strictEqual(after.confirmed_at, confirmer.confirmed_at);
  db.close();
});

test("6. 校对人员开始成功", () => {
  const db = freshDb();
  const taskId = publishTask(db, { operatorId: 1, bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 1 });
  confirmReceipt(db, taskId, 3);
  startTask(db, taskId, 4);
  assert.strictEqual(status(db, taskId), "IN_PROGRESS");
  assert.strictEqual(eventCount(db, taskId, "TASK_STARTED"), 1);
  const task = db.prepare("SELECT proofreader_id, started_at FROM tasks WHERE id = ?").get(taskId) as { proofreader_id: number; started_at: string };
  assert.strictEqual(task.proofreader_id, 4);
  assert.ok(task.started_at);
  db.close();
});

test("7. 两名校对人员开始同一任务，只有一人成功", () => {
  const db = freshDb();
  const taskId = publishTask(db, { operatorId: 1, bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 1 });
  confirmReceipt(db, taskId, 3);
  startTask(db, taskId, 4); // 校对甲成功
  assertThrowsCode(() => startTask(db, taskId, 5), "TASK_ALREADY_STARTED"); // 校对乙失败
  assert.strictEqual(status(db, taskId), "IN_PROGRESS");
  assert.strictEqual(eventCount(db, taskId, "TASK_STARTED"), 1);
  db.close();
});

test("8. 同一校对人员不能开始第二本", () => {
  const db = freshDb();
  const a = publishThenConfirmThenStart(db);
  const b = publishTask(db, { operatorId: 1, bookTitle: "第二本", stage: "INITIAL_REVIEW", starLevel: 1 });
  confirmReceipt(db, b, 3);
  assertThrowsCode(() => startTask(db, b, 4), "PROOFREADER_BUSY"); // 校对甲已有进行中
  assert.strictEqual(status(db, b), "READY_TO_START"); // 未改变
  assert.strictEqual(status(db, a), "IN_PROGRESS");
  db.close();
});

test("9. 非当前校对人员不能结束", () => {
  const db = freshDb();
  const taskId = publishThenConfirmThenStart(db); // 校对甲(4)开始
  assertThrowsCode(() => finishTask(db, taskId, 5), "NOT_TASK_PROOFREADER");
  db.close();
});

test("10. 当前校对人员能够结束", () => {
  const db = freshDb();
  const taskId = publishThenConfirmThenStart(db);
  finishTask(db, taskId, 4);
  assert.strictEqual(status(db, taskId), "COMPLETED");
  assert.strictEqual(eventCount(db, taskId, "TASK_COMPLETED"), 1);
  db.close();
});

test("11. 重复结束不生成重复事件", () => {
  const db = freshDb();
  const taskId = publishThenConfirmThenStart(db);
  finishTask(db, taskId, 4);
  finishTask(db, taskId, 4); // 重复结束
  assert.strictEqual(eventCount(db, taskId, "TASK_COMPLETED"), 1);
  db.close();
});

test("12. 管理员代开始生成审计记录", () => {
  const db = freshDb();
  const taskId = publishTask(db, { operatorId: 1, bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 1 });
  confirmReceipt(db, taskId, 3);
  const before = auditCount(db);
  startTask(db, taskId, 6, { proofreaderId: 4, proxyReason: "代开始" });
  assert.strictEqual(status(db, taskId), "IN_PROGRESS");
  assert.strictEqual(auditCount(db), before + 1);
  const task = db.prepare("SELECT proofreader_id FROM tasks WHERE id = ?").get(taskId) as { proofreader_id: number };
  assert.strictEqual(task.proofreader_id, 4);
  db.close();
});

test("13. 只有待确认或待开始可取消", () => {
  const db = freshDb();
  const a = publishTask(db, { operatorId: 1, bookTitle: "待确认", stage: "INITIAL_REVIEW", starLevel: 1 });
  cancelTask(db, a, 6, "误发"); // 待确认可取消
  assert.strictEqual(status(db, a), "CANCELLED");

  const b = publishTask(db, { operatorId: 1, bookTitle: "待开始", stage: "INITIAL_REVIEW", starLevel: 1 });
  confirmReceipt(db, b, 3);
  cancelTask(db, b, 6, "撤回"); // 待开始可取消
  assert.strictEqual(status(db, b), "CANCELLED");

  const c = publishThenConfirmThenStart(db);
  assertThrowsCode(() => cancelTask(db, c, 6, "不能取消进行中"), "INVALID_STATUS");
  db.close();
});

test("14. task_events 和 audit_log 不能更新或删除", () => {
  const db = freshDb();
  publishTask(db, { operatorId: 1, bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 1 });
  assert.throws(() => db.prepare("UPDATE task_events SET note = 'x' WHERE id = 1").run());
  assert.throws(() => db.prepare("DELETE FROM task_events WHERE id = 1").run());
  // 补一条审计后验证 audit_log 只追加
  db.prepare("INSERT INTO audit_log(operator_id, operation_type, target_type, target_id) VALUES (6, 'TEST', 'task', '1')").run();
  assert.throws(() => db.prepare("UPDATE audit_log SET reason = 'x' WHERE id = 1").run());
  assert.throws(() => db.prepare("DELETE FROM audit_log WHERE id = 1").run());
  db.close();
});

test("15. 事务回滚：失败不留半条记录", () => {
  const db = freshDb();
  // 直接验证事务机制：先写后抛错应整体回滚
  let insertedId = 0;
  assert.throws(() => {
    db.transaction(() => {
      const r = db.prepare("INSERT INTO tasks(book_id, stage, star_level, status) VALUES (1, 'INITIAL_REVIEW', 1, 'PENDING_CONFIRMATION')").run();
      insertedId = Number(r.lastInsertRowid);
      throw new Error("boom");
    })();
  });
  const c = (db.prepare("SELECT COUNT(*) c FROM tasks WHERE id = ?").get(insertedId) as { c: number }).c;
  assert.strictEqual(c, 0);
  db.close();
});

test("16. 完整流程只形成四条事件", () => {
  const db = freshDb();
  const taskId = publishTask(db, { operatorId: 1, bookTitle: "书", stage: "FIRST_PROOF", starLevel: 2 });
  confirmReceipt(db, taskId, 3);
  startTask(db, taskId, 4);
  finishTask(db, taskId, 4);
  const events = db.prepare("SELECT event_type FROM task_events WHERE task_id = ? ORDER BY id").all(taskId) as { event_type: string }[];
  assert.deepStrictEqual(
    events.map((e) => e.event_type),
    ["TASK_PUBLISHED", "RECEIPT_CONFIRMED", "TASK_STARTED", "TASK_COMPLETED"],
  );
  db.close();
});

test("17. 所有操作人和时间均由系统生成", () => {
  const db = freshDb();
  const taskId = publishTask(db, { operatorId: 1, bookTitle: "书", stage: "FIRST_PROOF", starLevel: 2 });
  confirmReceipt(db, taskId, 3);
  startTask(db, taskId, 4);
  finishTask(db, taskId, 4);
  const t = db.prepare("SELECT publisher_id, published_at, confirmer_id, confirmed_at, proofreader_id, started_at, finisher_id, finished_at FROM tasks WHERE id = ?").get(taskId) as Record<string, unknown>;
  for (const k of ["published_at", "confirmed_at", "started_at", "finished_at"]) {
    assert.ok(typeof t[k] === "string" && /^\d{4}-\d{2}-\d{2}T/.test(t[k] as string), `${k} 应为系统生成的 ISO 时间`);
  }
  assert.strictEqual(t.publisher_id, 1);
  assert.strictEqual(t.confirmer_id, 3);
  assert.strictEqual(t.proofreader_id, 4);
  assert.strictEqual(t.finisher_id, 4);
  db.close();
});

test("18. 正式数据库未被测试污染", () => {
  if (!fs.existsSync(FORMAL_PATH)) return; // 未初始化时跳过
  assert.deepStrictEqual(formalCounts(), FORMAL_BASELINE);
});
