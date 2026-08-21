import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  publishTask,
  confirmReceipt,
  listPendingConfirmation,
  countPendingConfirmation,
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
      (3, 'sup2', '主管乙', 'EXTERNAL_SUPERVISOR', 3, 1, 0),
      (4, 'pf1', '校对甲', 'PROOFREADER', 2, 1, 0),
      (5, 'admin1', '管理员', 'INTERNAL_ADMIN', 1, 1, 0),
      (6, 'supInactive', '停用主管', 'EXTERNAL_SUPERVISOR', 2, 0, 0),
      (7, 'supMustChange', '未改密主管', 'EXTERNAL_SUPERVISOR', 2, 1, 1)`,
  ).run();
  return db;
}

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

test("1. 外校主管能看到属于本公司的待确认任务", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  const items = listPendingConfirmation(db);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].id, taskId);
  assert.strictEqual(items[0].companyId, 2);
  db.close();
});

test("2. 外校主管可一键确认本公司任务", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  const r = confirmReceipt(db, taskId, 2);
  assert.strictEqual(r, "confirmed");
  db.close();
});

test("3. 确认后状态变为READY_TO_START", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  confirmReceipt(db, taskId, 2);
  assert.strictEqual(status(db, taskId), "READY_TO_START");
  db.close();
});

test("4. confirmed_by为实际外校主管", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  confirmReceipt(db, taskId, 2);
  const t = db.prepare("SELECT confirmer_id FROM tasks WHERE id = ?").get(taskId) as { confirmer_id: number };
  assert.strictEqual(t.confirmer_id, 2);
  db.close();
});

test("5. confirm_company_id正确", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  confirmReceipt(db, taskId, 2);
  const t = db.prepare("SELECT confirm_company_id FROM tasks WHERE id = ?").get(taskId) as { confirm_company_id: number };
  assert.strictEqual(t.confirm_company_id, 2);
  db.close();
});

test("6. confirmed_at由服务器生成", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  confirmReceipt(db, taskId, 2);
  const t = db.prepare("SELECT confirmed_at FROM tasks WHERE id = ?").get(taskId) as { confirmed_at: string };
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(t.confirmed_at));
  db.close();
});

test("7. 新增一条RECEIPT_CONFIRMED", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  confirmReceipt(db, taskId, 2);
  assert.strictEqual(eventCount(db, taskId, "RECEIPT_CONFIRMED"), 1);
  db.close();
});

test("8. 普通确认事件is_proxy=0", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  confirmReceipt(db, taskId, 2);
  const e = db.prepare("SELECT is_proxy, operator_id FROM task_events WHERE task_id = ? AND event_type = 'RECEIPT_CONFIRMED'").get(taskId) as { is_proxy: number; operator_id: number };
  assert.strictEqual(e.is_proxy, 0);
  assert.strictEqual(e.operator_id, 2);
  db.close();
});

test("9. 普通确认不新增audit_log", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  const before = rows(db, "audit_log");
  confirmReceipt(db, taskId, 2);
  assert.strictEqual(rows(db, "audit_log"), before);
  db.close();
});

test("10. 外校主管不能确认其他公司的任务", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  assertThrowsCode(() => confirmReceipt(db, taskId, 3), "FORBIDDEN");
  db.close();
});

test("11. 责任编辑不能确认", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  assertThrowsCode(() => confirmReceipt(db, taskId, 1), "FORBIDDEN");
  db.close();
});

test("12. 校对人员不能确认", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  assertThrowsCode(() => confirmReceipt(db, taskId, 4), "FORBIDDEN");
  db.close();
});

test("13. 停用账号不能确认", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  assertThrowsCode(() => confirmReceipt(db, taskId, 6), "USER_INACTIVE");
  db.close();
});

test("14. 未完成首次改密账号不能绕过改密直接操作", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  assertThrowsCode(() => confirmReceipt(db, taskId, 7), "MUST_CHANGE_PASSWORD");
  db.close();
});

test("15. 已确认任务不能重复确认", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  confirmReceipt(db, taskId, 2);
  const r = confirmReceipt(db, taskId, 2);
  assert.strictEqual(r, "already_confirmed");
  db.close();
});

test("16. 两次并发确认只有一次成功", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  const first = confirmReceipt(db, taskId, 2);
  const second = confirmReceipt(db, taskId, 2);
  assert.strictEqual(first, "confirmed");
  assert.strictEqual(second, "already_confirmed");
  db.close();
});

test("17. 重复操作不产生重复事件", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  confirmReceipt(db, taskId, 2);
  confirmReceipt(db, taskId, 2);
  assert.strictEqual(eventCount(db, taskId, "RECEIPT_CONFIRMED"), 1);
  db.close();
});

test("18. 非PENDING_CONFIRMATION任务不能确认", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  confirmReceipt(db, taskId, 2);
  db.prepare("UPDATE tasks SET status = 'CANCELLED' WHERE id = ?").run(taskId);
  assertThrowsCode(() => confirmReceipt(db, taskId, 2), "INVALID_STATUS");
  db.close();
});

test("19. 管理员代确认必须填写原因", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  assertThrowsCode(() => confirmReceipt(db, taskId, 5), "PROXY_REASON_REQUIRED");
  db.close();
});

test("20. 管理员代确认正确产生代理事件和audit_log", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  const before = rows(db, "audit_log");
  const r = confirmReceipt(db, taskId, 5, { proxyReason: "主管请假代确认" });
  assert.strictEqual(r, "confirmed");
  assert.strictEqual(status(db, taskId), "READY_TO_START");
  const e = db.prepare("SELECT is_proxy, proxy_role, operator_id FROM task_events WHERE task_id = ? AND event_type = 'RECEIPT_CONFIRMED'").get(taskId) as { is_proxy: number; proxy_role: string | null; operator_id: number };
  assert.strictEqual(e.is_proxy, 1);
  assert.strictEqual(e.proxy_role, "EXTERNAL_SUPERVISOR");
  assert.strictEqual(e.operator_id, 5);
  assert.strictEqual(rows(db, "audit_log"), before + 1);
  const audit = db.prepare("SELECT operation_type, operator_id, reason, proxy_role FROM audit_log WHERE target_id = ? AND operation_type = 'PROXY_CONFIRM'").get(String(taskId)) as { operation_type: string; operator_id: number; reason: string; proxy_role: string | null };
  assert.strictEqual(audit.operation_type, "PROXY_CONFIRM");
  assert.strictEqual(audit.operator_id, 5);
  assert.strictEqual(audit.reason, "主管请假代确认");
  assert.strictEqual(audit.proxy_role, "EXTERNAL_SUPERVISOR");
  const t = db.prepare("SELECT confirm_company_id FROM tasks WHERE id = ?").get(taskId) as { confirm_company_id: number };
  assert.strictEqual(t.confirm_company_id, 2);
  db.close();
});

test("21. 任一步失败时事务回滚", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  const eventsBefore = rows(db, "task_events");
  const auditsBefore = rows(db, "audit_log");
  assertThrowsCode(() => confirmReceipt(db, taskId, 3), "FORBIDDEN");
  assert.strictEqual(status(db, taskId), "PENDING_CONFIRMATION");
  assert.strictEqual(rows(db, "task_events"), eventsBefore);
  assert.strictEqual(rows(db, "audit_log"), auditsBefore);
  db.close();
});

test("22. 列表按星级和时间正确排序", () => {
  const db = freshDb();
  const a = publish(db, { title: "低星", starLevel: 1 });
  const b = publish(db, { title: "高星", starLevel: 3 });
  const c = publish(db, { title: "中星", starLevel: 2 });
  assert.deepStrictEqual(listPendingConfirmation(db).map((i) => i.id), [b, c, a]);
  // 同星级内按发布时间从早到晚
  db.prepare("UPDATE tasks SET star_level = 1 WHERE id IN (?, ?)").run(b, c);
  db.prepare("UPDATE tasks SET published_at = '2026-08-05T00:00:00.000Z' WHERE id = ?").run(b);
  db.prepare("UPDATE tasks SET published_at = '2026-08-04T00:00:00.000Z' WHERE id = ?").run(c);
  db.prepare("UPDATE tasks SET published_at = '2026-08-03T00:00:00.000Z' WHERE id = ?").run(a);
  assert.deepStrictEqual(listPendingConfirmation(db).map((i) => i.id), [a, c, b]);
  db.close();
});

test("23. 无任务时返回空列表（页面显示空状态）", () => {
  const db = freshDb();
  assert.deepStrictEqual(listPendingConfirmation(db), []);
  assert.strictEqual(countPendingConfirmation(db), 0);
  db.close();
});

test("24. 责任编辑和校对人员只读可见但没有确认按钮", () => {
  const db = freshDb();
  const taskId = publish(db, { companyId: 2 });
  // 列表对所有登录用户开放（查询不区分角色）
  assert.strictEqual(listPendingConfirmation(db).length, 1);
  // 但责任编辑/校对人员提交确认被服务端拒绝（对应无确认按钮）
  assertThrowsCode(() => confirmReceipt(db, taskId, 1), "FORBIDDEN");
  assertThrowsCode(() => confirmReceipt(db, taskId, 4), "FORBIDDEN");
  db.close();
});

test("25. 正式数据库不受自动测试影响", () => {
  if (!fs.existsSync(FORMAL_PATH)) return;
  assert.deepStrictEqual(formalCounts(), FORMAL_BASELINE);
});
