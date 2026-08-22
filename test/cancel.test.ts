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
import { ROLE_LABELS } from "../lib/search-service.ts";

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

function publish(db: Database.Database, editorId = 1): number {
  return publishTask(db, { operatorId: editorId, bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 2 });
}

function status(db: Database.Database, taskId: number): string {
  return (db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as { status: string }).status;
}

function rows(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c;
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

test("1. Dominance 可以取消 PENDING_CONFIRMATION", () => {
  const db = freshDb();
  const id = publish(db);
  cancelTask(db, id, 4, "误发");
  assert.strictEqual(status(db, id), "CANCELLED");
  db.close();
});

test("2. Dominance 可以取消 READY_TO_START", () => {
  const db = freshDb();
  const id = publish(db);
  confirmReceipt(db, id, 2);
  cancelTask(db, id, 4, "撤回");
  assert.strictEqual(status(db, id), "CANCELLED");
  db.close();
});

test("3. 责任编辑可以取消自己书稿的 PENDING_CONFIRMATION", () => {
  const db = freshDb();
  const id = publish(db, 1);
  cancelTask(db, id, 1, "误发");
  assert.strictEqual(status(db, id), "CANCELLED");
  db.close();
});

test("4. 责任编辑可以取消自己书稿的 READY_TO_START", () => {
  const db = freshDb();
  const id = publish(db, 1);
  confirmReceipt(db, id, 2);
  cancelTask(db, id, 1, "撤回");
  assert.strictEqual(status(db, id), "CANCELLED");
  db.close();
});

test("5. 责任编辑不能取消其他责任编辑的任务", () => {
  const db = freshDb();
  const id = publish(db, 1); // 编辑甲发布
  assertThrowsCode(() => cancelTask(db, id, 5, "x"), "FORBIDDEN"); // 编辑乙
  db.close();
});

test("6. 责任编辑不能取消 IN_PROGRESS", () => {
  const db = freshDb();
  const id = publish(db, 1);
  confirmReceipt(db, id, 2);
  startTask(db, id, 3);
  assertThrowsCode(() => cancelTask(db, id, 1, "x"), "INVALID_STATUS");
  db.close();
});

test("7. 责任编辑不能取消 COMPLETED", () => {
  const db = freshDb();
  const id = publish(db, 1);
  confirmReceipt(db, id, 2);
  startTask(db, id, 3);
  finishTask(db, id, 3);
  assertThrowsCode(() => cancelTask(db, id, 1, "x"), "INVALID_STATUS");
  db.close();
});

test("8. 责任编辑不能重复取消 CANCELLED", () => {
  const db = freshDb();
  const id = publish(db, 1);
  cancelTask(db, id, 1, "误发");
  cancelTask(db, id, 1, "再取消"); // 幂等
  assert.strictEqual(eventCount(db, id, "TASK_CANCELLED"), 1);
  db.close();
});

test("9. 外校主管不能取消", () => {
  const db = freshDb();
  const id = publish(db, 1);
  assertThrowsCode(() => cancelTask(db, id, 2, "x"), "FORBIDDEN");
  db.close();
});

test("10. 校对人员不能取消", () => {
  const db = freshDb();
  const id = publish(db, 1);
  assertThrowsCode(() => cancelTask(db, id, 3, "x"), "FORBIDDEN");
  db.close();
});

test("11. Dominance 可以取消任意责任编辑的待确认任务", () => {
  const db = freshDb();
  const id = publish(db, 5); // 编辑乙发布
  cancelTask(db, id, 4, "纠错取消");
  assert.strictEqual(status(db, id), "CANCELLED");
  db.close();
});

test("12. Dominance 不能取消进行中任务", () => {
  const db = freshDb();
  const id = publish(db, 1);
  confirmReceipt(db, id, 2);
  startTask(db, id, 3);
  assertThrowsCode(() => cancelTask(db, id, 4, "x"), "INVALID_STATUS");
  db.close();
});

test("13. 空原因被拒绝", () => {
  const db = freshDb();
  const id = publish(db);
  assertThrowsCode(() => cancelTask(db, id, 4, ""), "PROXY_REASON_REQUIRED");
  db.close();
});

test("14. 纯空格原因被拒绝", () => {
  const db = freshDb();
  const id = publish(db);
  assertThrowsCode(() => cancelTask(db, id, 4, "   "), "PROXY_REASON_REQUIRED");
  db.close();
});

test("15. 超过 200 字被拒绝", () => {
  const db = freshDb();
  const id = publish(db);
  assertThrowsCode(() => cancelTask(db, id, 4, "a".repeat(201)), "INVALID_INPUT");
  db.close();
});

test("16. 正常取消只新增一条 TASK_CANCELLED", () => {
  const db = freshDb();
  const id = publish(db);
  cancelTask(db, id, 4, "误发");
  assert.strictEqual(eventCount(db, id, "TASK_CANCELLED"), 1);
  db.close();
});

test("17. 并发或重复点击只有一次成功", () => {
  const db = freshDb();
  const id = publish(db);
  cancelTask(db, id, 4, "误发");
  cancelTask(db, id, 4, "再取消");
  assert.strictEqual(eventCount(db, id, "TASK_CANCELLED"), 1);
  db.close();
});

test("18. cancelled_by 是真实操作人", () => {
  const db = freshDb();
  const id = publish(db, 1);
  cancelTask(db, id, 1, "误发");
  const t = db.prepare("SELECT cancelled_by FROM tasks WHERE id = ?").get(id) as { cancelled_by: number };
  assert.strictEqual(t.cancelled_by, 1);
  db.close();
});

test("19. cancelled_at 由服务器生成", () => {
  const db = freshDb();
  const id = publish(db);
  cancelTask(db, id, 4, "误发");
  const t = db.prepare("SELECT cancelled_at FROM tasks WHERE id = ?").get(id) as { cancelled_at: string };
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(t.cancelled_at));
  db.close();
});

test("20. 取消后原书稿、原任务和旧事件仍完整保留", () => {
  const db = freshDb();
  const id = publish(db);
  cancelTask(db, id, 4, "误发");
  assert.strictEqual(rows(db, "books"), 1);
  assert.strictEqual(rows(db, "tasks"), 1);
  assert.strictEqual(eventCount(db, id, "TASK_PUBLISHED"), 1);
  assert.strictEqual(eventCount(db, id, "TASK_CANCELLED"), 1);
  db.close();
});

test("21. INTERNAL_ADMIN 内部值不变（数据库仍用 INTERNAL_ADMIN）", () => {
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  assert.ok(schema.includes("INTERNAL_ADMIN"));
});

test("22. 界面角色映射显示为 Dominance", () => {
  assert.strictEqual(ROLE_LABELS.INTERNAL_ADMIN, "Dominance");
});

test("23. 责任编辑本人取消时 is_proxy=0、operator_id 正确、不写审计", () => {
  const db = freshDb();
  const id = publish(db, 1);
  const auditsBefore = rows(db, "audit_log");
  cancelTask(db, id, 1, "误发");
  const e = db.prepare("SELECT operator_id, is_proxy, proxy_role FROM task_events WHERE task_id = ? AND event_type = 'TASK_CANCELLED'").get(id) as { operator_id: number; is_proxy: number; proxy_role: string | null };
  assert.strictEqual(e.operator_id, 1);
  assert.strictEqual(e.is_proxy, 0);
  assert.strictEqual(e.proxy_role, null);
  assert.strictEqual(rows(db, "audit_log"), auditsBefore);
  db.close();
});

test("24. Dominance 代取消时 is_proxy=1、代理角色与审计正确", () => {
  const db = freshDb();
  const id = publish(db, 1);
  const auditsBefore = rows(db, "audit_log");
  cancelTask(db, id, 4, "纠错取消");
  const e = db.prepare("SELECT operator_id, is_proxy, proxy_role FROM task_events WHERE task_id = ? AND event_type = 'TASK_CANCELLED'").get(id) as { operator_id: number; is_proxy: number; proxy_role: string | null };
  assert.strictEqual(e.operator_id, 4);
  assert.strictEqual(e.is_proxy, 1);
  assert.strictEqual(e.proxy_role, "RESPONSIBLE_EDITOR");
  assert.strictEqual(rows(db, "audit_log"), auditsBefore + 1);
  const audit = db.prepare("SELECT operation_type, operator_id, reason, proxy_role FROM audit_log WHERE target_id = ? AND operation_type = 'PROXY_CANCEL'").get(String(id)) as { operation_type: string; operator_id: number; reason: string; proxy_role: string | null };
  assert.strictEqual(audit.operation_type, "PROXY_CANCEL");
  assert.strictEqual(audit.operator_id, 4);
  assert.strictEqual(audit.reason, "纠错取消");
  assert.strictEqual(audit.proxy_role, "RESPONSIBLE_EDITOR");
  db.close();
});

test("25. 取消后活动任务统计正确（不进入仓库/生产线/滞留）", () => {
  const db = freshDb();
  const id = publish(db, 1);
  cancelTask(db, id, 1, "误发");
  assert.strictEqual(status(db, id), "CANCELLED");
  // CANCELLED 不计入活动任务
  assert.strictEqual(rows(db, "tasks"), 1); // 任务仍在
  db.close();
});

test("26. 正式数据库不被测试污染", () => {
  if (!fs.existsSync(FORMAL_PATH)) return;
  assert.deepStrictEqual(formalCounts(), FORMAL_BASELINE);
});
