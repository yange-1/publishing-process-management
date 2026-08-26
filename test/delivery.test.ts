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
  type TaskServiceError,
} from "../lib/task-service.ts";
import { deliverTask, confirmDeliveryReceipt, recentDeliveryCutoffMs } from "../lib/delivery-service.ts";
import {
  listInTransit,
  countInTransit,
  listInTransitByEditor,
  listDeliveredUnconfirmedByEditor,
  countDeliveredUnconfirmedByEditor,
  countCompleted,
  listCompletedByEditor,
} from "../lib/dashboard-service.ts";
import { searchBooks } from "../lib/search-service.ts";
import { listMyTodos } from "../lib/todo-service.ts";

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

function errCode(e: unknown): string {
  return (e as TaskServiceError)?.code ?? "";
}

function publish(
  db: Database.Database,
  opts: { operatorId?: number; title?: string; companyId?: number; starLevel?: number } = {},
): number {
  return publishTask(db, {
    operatorId: opts.operatorId ?? 1,
    bookTitle: opts.title ?? "书",
    stage: "FIRST_PROOF",
    starLevel: opts.starLevel ?? 1,
    companyId: opts.companyId ?? 2,
  });
}

function confirm(db: Database.Database, taskId: number, companyId = 2): void {
  confirmReceipt(db, taskId, companyId === 3 ? 7 : 2);
}

function toReady(
  db: Database.Database,
  opts: { operatorId?: number; title?: string; companyId?: number } = {},
): number {
  const id = publish(db, opts);
  confirm(db, id, opts.companyId ?? 2);
  return id;
}

function toInProgress(
  db: Database.Database,
  opts: { operatorId?: number; title?: string; companyId?: number; proofreaderId?: number } = {},
): number {
  const companyId = opts.companyId ?? 2;
  const id = toReady(db, { operatorId: opts.operatorId, title: opts.title, companyId });
  startTask(db, id, opts.proofreaderId ?? (companyId === 3 ? 8 : 3));
  return id;
}

function toCompleted(
  db: Database.Database,
  opts: { operatorId?: number; title?: string; companyId?: number; proofreaderId?: number } = {},
): number {
  const companyId = opts.companyId ?? 2;
  const pf = opts.proofreaderId ?? (companyId === 3 ? 8 : 3);
  const id = toInProgress(db, { operatorId: opts.operatorId, title: opts.title, companyId, proofreaderId: pf });
  finishTask(db, id, pf);
  return id;
}

// 直接写入一条送达记录（用于构造确定性送达时间，测试 7 日窗口边界）。
function insertDelivery(db: Database.Database, taskId: number, deliveredBy: number, deliveredAtIso: string): void {
  db.prepare("INSERT INTO deliveries(task_id, delivered_by, delivered_at) VALUES (?,?,?)").run(taskId, deliveredBy, deliveredAtIso);
}

test("1. 已结束校对、未送达的任务进入对应公司运送中，状态仍为 COMPLETED", () => {
  const db = freshDb();
  const id = toCompleted(db, { operatorId: 1, title: "完成待送", companyId: 2, proofreaderId: 3 });
  assert.ok(listInTransit(db, 2).some((t) => t.id === id));
  assert.strictEqual(countInTransit(db, 2), 1);
  assert.strictEqual(
    (db.prepare("SELECT status FROM tasks WHERE id = ?").get(id) as { status: string }).status,
    "COMPLETED",
  );
  db.close();
});

test("2. 升级前历史 COMPLETED 任务（无 deliveries 记录）也进入运送中", () => {
  const db = freshDb();
  db.prepare("INSERT INTO books(id, title, editor_id) VALUES (99, '历史书', 1)").run();
  db.prepare(
    "INSERT INTO tasks(id, book_id, stage, work_type, star_level, status, company_id, finished_at) VALUES (999, 99, 'FIRST_PROOF', 'PROOFREAD', 1, 'COMPLETED', 2, '2026-08-01T00:00:00Z')",
  ).run();
  assert.ok(listInTransit(db, 2).some((t) => t.id === 999));
  db.close();
});

test("3. 未完成、已取消、已送达及其他公司任务不进入本公司运送中", () => {
  const db = freshDb();
  const inProgressId = toInProgress(db, { operatorId: 1, title: "进行中", companyId: 2, proofreaderId: 3 });
  const cancelledId = publish(db, { operatorId: 1, title: "取消", companyId: 2 });
  cancelTask(db, cancelledId, 1, "误发");
  const otherCompanyCompleted = toCompleted(db, { operatorId: 1, title: "别家公司", companyId: 3, proofreaderId: 8 });
  const deliveredId = toCompleted(db, { operatorId: 1, title: "已送达", companyId: 2, proofreaderId: 5 });
  deliverTask(db, deliveredId, 2);

  const ids = listInTransit(db, 2).map((t) => t.id);
  assert.ok(!ids.includes(inProgressId));
  assert.ok(!ids.includes(cancelledId));
  assert.ok(!ids.includes(otherCompanyCompleted));
  assert.ok(!ids.includes(deliveredId));
  assert.strictEqual(countInTransit(db, 2), 0);
  assert.strictEqual(countInTransit(db, 3), 1); // 别家公司已完成未送达，仍在其主管运送中
  db.close();
});

test("4. 外校主管可以送达本公司任务，并记录送达人与时间", () => {
  const db = freshDb();
  const id = toCompleted(db, { operatorId: 1, companyId: 2, proofreaderId: 3 });
  assert.strictEqual(deliverTask(db, id, 2), "delivered");
  const d = db
    .prepare("SELECT delivered_by, delivered_at FROM deliveries WHERE task_id = ?")
    .get(id) as { delivered_by: number; delivered_at: string };
  assert.strictEqual(d.delivered_by, 2);
  assert.ok(d.delivered_at);
  assert.strictEqual(
    (db.prepare("SELECT status FROM tasks WHERE id = ?").get(id) as { status: string }).status,
    "COMPLETED",
  );
  db.close();
});

test("5. 外校主管不能送达其他公司任务", () => {
  const db = freshDb();
  const id = toCompleted(db, { operatorId: 1, companyId: 3, proofreaderId: 8 });
  assert.throws(() => deliverTask(db, id, 2), (e: unknown) => errCode(e) === "FORBIDDEN");
  db.close();
});

test("6. 非外校主管（校对人员/责任编辑）无权直接送达", () => {
  const db = freshDb();
  const id = toCompleted(db, { operatorId: 1, companyId: 2, proofreaderId: 3 });
  assert.throws(() => deliverTask(db, id, 3), (e: unknown) => errCode(e) === "FORBIDDEN");
  assert.throws(() => deliverTask(db, id, 1), (e: unknown) => errCode(e) === "FORBIDDEN");
  db.close();
});

test("7. Dominance 可以代送达，但必须填写原因", () => {
  const db = freshDb();
  const id = toCompleted(db, { operatorId: 1, companyId: 2, proofreaderId: 3 });
  assert.throws(() => deliverTask(db, id, 4), (e: unknown) => errCode(e) === "PROXY_REASON_REQUIRED");
  assert.strictEqual(deliverTask(db, id, 4, { proxyReason: "代送达" }), "delivered");
  db.close();
});

test("8. Dominance 代送达正确记录操作者、代操作角色与原因（含审计）", () => {
  const db = freshDb();
  const id = toCompleted(db, { operatorId: 1, companyId: 2, proofreaderId: 3 });
  deliverTask(db, id, 4, { proxyReason: "主管请假代送达" });
  const d = db
    .prepare("SELECT delivered_by, is_proxy, proxy_role, proxy_reason FROM deliveries WHERE task_id = ?")
    .get(id) as { delivered_by: number; is_proxy: number; proxy_role: string; proxy_reason: string };
  assert.strictEqual(d.delivered_by, 4);
  assert.strictEqual(d.is_proxy, 1);
  assert.strictEqual(d.proxy_role, "EXTERNAL_SUPERVISOR");
  assert.strictEqual(d.proxy_reason, "主管请假代送达");
  const audit = db
    .prepare("SELECT operator_id, reason, proxy_role FROM audit_log WHERE operation_type = 'PROXY_DELIVER' AND target_id = ?")
    .get(String(id)) as { operator_id: number; reason: string; proxy_role: string };
  assert.strictEqual(audit.operator_id, 4); // 真实操作人为 Dominance
  assert.strictEqual(audit.reason, "主管请假代送达");
  assert.strictEqual(audit.proxy_role, "EXTERNAL_SUPERVISOR");
  db.close();
});

test("9. 重复送达被服务端安全拒绝，不产生第二条记录", () => {
  const db = freshDb();
  const id = toCompleted(db, { operatorId: 1, companyId: 2, proofreaderId: 3 });
  assert.strictEqual(deliverTask(db, id, 2), "delivered");
  assert.strictEqual(deliverTask(db, id, 2), "already_delivered");
  const c = (db.prepare("SELECT COUNT(*) c FROM deliveries WHERE task_id = ?").get(id) as { c: number }).c;
  assert.strictEqual(c, 1);
  db.close();
});

test("10. 送达后任务立即从运送中消失", () => {
  const db = freshDb();
  const id = toCompleted(db, { operatorId: 1, companyId: 2, proofreaderId: 3 });
  assert.ok(listInTransit(db, 2).some((t) => t.id === id));
  deliverTask(db, id, 2);
  assert.ok(!listInTransit(db, 2).some((t) => t.id === id));
  db.close();
});

test("11. 责任编辑只能看到本人书稿的已送达", () => {
  const db = freshDb();
  const mine = toCompleted(db, { operatorId: 1, title: "我的", companyId: 2, proofreaderId: 3 });
  deliverTask(db, mine, 2);
  const other = toCompleted(db, { operatorId: 6, title: "别人的", companyId: 2, proofreaderId: 5 });
  deliverTask(db, other, 2);
  const cutoff = new Date(0).toISOString();
  assert.ok(listDeliveredUnconfirmedByEditor(db, 1, cutoff).some((t) => t.id === mine));
  assert.ok(!listDeliveredUnconfirmedByEditor(db, 1, cutoff).some((t) => t.id === other));
  assert.strictEqual(countDeliveredUnconfirmedByEditor(db, 1, cutoff), 1);
  assert.ok(listDeliveredUnconfirmedByEditor(db, 6, cutoff).some((t) => t.id === other));
  db.close();
});

test("12. 已送达按送达时间倒序", () => {
  const db = freshDb();
  const a = toCompleted(db, { operatorId: 1, title: "A", companyId: 2, proofreaderId: 3 });
  const b = toCompleted(db, { operatorId: 1, title: "B", companyId: 2, proofreaderId: 5 });
  insertDelivery(db, a, 2, "2026-08-01T00:00:00Z");
  insertDelivery(db, b, 2, "2026-08-02T00:00:00Z");
  const list = listDeliveredUnconfirmedByEditor(db, 1, new Date(0).toISOString());
  const idxA = list.findIndex((t) => t.id === a);
  const idxB = list.findIndex((t) => t.id === b);
  assert.ok(idxA >= 0 && idxB >= 0);
  assert.ok(idxB < idxA); // b 送达更晚，应排在前面
  db.close();
});

test("13. recentDeliveryCutoffMs 按上海自然日计算窗口起点（含跨月）", () => {
  // 上海 2026-08-07 00:00（= UTC 08-06T16:00）→ 窗口起点 = 8月1日 00:00 上海 = UTC 07-31T16:00
  assert.strictEqual(
    recentDeliveryCutoffMs(new Date("2026-08-06T16:00:00Z")),
    Date.UTC(2026, 6, 31, 16, 0, 0),
  );
  // 上海 2026-08-01 12:00（= UTC 08-01T04:00）→ 窗口起点 = 7月26日 00:00 上海 = UTC 07-25T16:00（跨月）
  assert.strictEqual(
    recentDeliveryCutoffMs(new Date("2026-08-01T04:00:00Z")),
    Date.UTC(2026, 6, 25, 16, 0, 0),
  );
});

test("14. 第7天仍显示、第8天不显示，但数据库送达记录仍存在", () => {
  const db = freshDb();
  const id = toCompleted(db, { operatorId: 1, title: "边界", companyId: 2, proofreaderId: 3 });
  // 送达时间：上海 8月1日 12:00 = UTC 08-01T04:00
  insertDelivery(db, id, 2, "2026-08-01T04:00:00Z");

  // “今天”= 8月7日 → 窗口起点 8月1日 00:00 上海，8月1日送达仍在窗口内
  const cutoffDay7 = new Date(recentDeliveryCutoffMs(new Date("2026-08-06T16:00:00Z"))).toISOString();
  // “今天”= 8月8日 → 窗口起点 8月2日 00:00 上海，8月1日送达已不在窗口内
  const cutoffDay8 = new Date(recentDeliveryCutoffMs(new Date("2026-08-07T16:00:00Z"))).toISOString();

  assert.ok(listDeliveredUnconfirmedByEditor(db, 1, cutoffDay7).some((t) => t.id === id));
  assert.ok(!listDeliveredUnconfirmedByEditor(db, 1, cutoffDay8).some((t) => t.id === id));
  // 记录永久保留，不因超出窗口被删除
  const c = (db.prepare("SELECT COUNT(*) c FROM deliveries WHERE task_id = ?").get(id) as { c: number }).c;
  assert.strictEqual(c, 1);
  db.close();
});

test("15. 送达不影响完成量、已完成列表、校对历史、待办与搜索", () => {
  const db = freshDb();
  const id = toCompleted(db, { operatorId: 1, title: "统计书", companyId: 2, proofreaderId: 3 });
  const completedBefore = countCompleted(db);
  const eventsBefore = (db.prepare("SELECT COUNT(*) c FROM task_events WHERE task_id = ?").get(id) as { c: number }).c;

  deliverTask(db, id, 2);

  assert.strictEqual(countCompleted(db), completedBefore); // 完成量不变
  assert.ok(listCompletedByEditor(db, 1).some((t) => t.id === id)); // 已完成列表仍含
  assert.strictEqual(
    (db.prepare("SELECT COUNT(*) c FROM task_events WHERE task_id = ?").get(id) as { c: number }).c,
    eventsBefore,
  ); // 校对历史事件不新增
  assert.ok(searchBooks(db, "统计书", 1, 20).results.some((x) => x.title === "统计书")); // 搜索不受影响
  assert.ok(
    listMyTodos(db, { id: 1, role: "RESPONSIBLE_EDITOR", companyId: 1 }).completedCount >= 1,
  ); // 待办已完成分组不受影响
  db.close();
});

test("16. deliveries 表只追加，UPDATE 与 DELETE 被拒绝", () => {
  const db = freshDb();
  const id = toCompleted(db, { operatorId: 1, companyId: 2, proofreaderId: 3 });
  deliverTask(db, id, 2);
  assert.throws(() => db.prepare("UPDATE deliveries SET delivered_by = 1 WHERE task_id = ?").run(id));
  assert.throws(() => db.prepare("DELETE FROM deliveries WHERE task_id = ?").run(id));
  db.close();
});

test("17. 自动测试不污染正式数据库", () => {
  if (!fs.existsSync(FORMAL_PATH)) return;
  assert.deepStrictEqual(formalCounts(), FORMAL_BASELINE);
});

test("18. 送达人必填：delivered_by 为空的直接插入被拒绝，正常送达仍成功", () => {
  const db = freshDb();
  const id = toCompleted(db, { operatorId: 1, companyId: 2, proofreaderId: 3 });
  assert.throws(() =>
    db.prepare("INSERT INTO deliveries(task_id, delivered_at) VALUES (?,?)").run(id, "2026-08-01T00:00:00Z"),
  );
  assert.strictEqual(deliverTask(db, id, 2), "delivered");
  db.close();
});

test("19. 历史库（delivered_by 可空）上触发器仍拒绝空送达人", () => {
  // 模拟已存在的演示库：deliveries.delivered_by 可空，仅靠 BEFORE INSERT 触发器兜底。
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tasks (id INTEGER PRIMARY KEY, status TEXT);
    CREATE TABLE deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL UNIQUE,
      delivered_by INTEGER,
      delivered_at TEXT NOT NULL
    );
    CREATE TRIGGER trg_deliveries_require_delivered_by
    BEFORE INSERT ON deliveries
    WHEN NEW.delivered_by IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'deliveries.delivered_by 不能为空');
    END;
  `);
  db.prepare("INSERT INTO tasks(id, status) VALUES (1, 'COMPLETED')").run();
  assert.throws(() =>
    db.prepare("INSERT INTO deliveries(task_id, delivered_at) VALUES (1, '2026-08-01T00:00:00Z')").run(),
  );
  db.prepare("INSERT INTO deliveries(task_id, delivered_by, delivered_at) VALUES (1, 2, '2026-08-01T00:00:00Z')").run();
  db.close();
});

test("20. Dominance 重复代送达不重复写审计记录", () => {
  const db = freshDb();
  const id = toCompleted(db, { operatorId: 1, companyId: 2, proofreaderId: 3 });
  assert.strictEqual(deliverTask(db, id, 4, { proxyReason: "代送达" }), "delivered");
  assert.strictEqual(deliverTask(db, id, 4, { proxyReason: "再次代送达" }), "already_delivered");
  const c = (
    db
      .prepare("SELECT COUNT(*) c FROM audit_log WHERE operation_type = 'PROXY_DELIVER' AND target_id = ?")
      .get(String(id)) as { c: number }
  ).c;
  assert.strictEqual(c, 1);
  db.close();
});

test("21. 编辑只能看到自己的配送中稿件，且不受7天限制", () => {
  const db = freshDb();
  const mine = toCompleted(db, { operatorId: 1, title: "我的配送中", companyId: 2, proofreaderId: 3 });
  const other = toCompleted(db, { operatorId: 6, title: "别人的配送中", companyId: 2, proofreaderId: 5 });
  // 把 finished_at 回拨到 30 天前，验证“配送中”不受 7 日窗口限制
  db.prepare("UPDATE tasks SET finished_at = ? WHERE id = ?").run(
    new Date(Date.now() - 30 * 86400000).toISOString(),
    mine,
  );
  const mineList = listInTransitByEditor(db, 1);
  assert.ok(mineList.some((t) => t.id === mine));
  assert.ok(!mineList.some((t) => t.id === other));
  assert.ok(listInTransitByEditor(db, 6).some((t) => t.id === other));
  db.close();
});

test("22. 外校主管送达后本人编辑看到已送达未确认，其他编辑看不到", () => {
  const db = freshDb();
  const mine = toCompleted(db, { operatorId: 1, title: "我的已送达", companyId: 2, proofreaderId: 3 });
  deliverTask(db, mine, 2);
  const cutoff = new Date(0).toISOString();
  assert.ok(listDeliveredUnconfirmedByEditor(db, 1, cutoff).some((t) => t.id === mine));
  assert.ok(!listDeliveredUnconfirmedByEditor(db, 6, cutoff).some((t) => t.id === mine));
  db.close();
});

test("23. 对应责任编辑可以确认收到，记录 confirmed_by 与 confirmed_at", () => {
  const db = freshDb();
  const id = toCompleted(db, { operatorId: 1, companyId: 2, proofreaderId: 3 });
  deliverTask(db, id, 2);
  assert.strictEqual(confirmDeliveryReceipt(db, id, 1), "confirmed");
  const r = db
    .prepare(
      "SELECT confirmed_by, confirmed_at FROM delivery_receipts WHERE delivery_id = (SELECT id FROM deliveries WHERE task_id = ?)",
    )
    .get(id) as { confirmed_by: number; confirmed_at: string };
  assert.strictEqual(r.confirmed_by, 1);
  assert.ok(r.confirmed_at);
  db.close();
});

test("24. 其他编辑确认返回 FORBIDDEN；外校主管/校对人员不能确认", () => {
  const db = freshDb();
  const id = toCompleted(db, { operatorId: 1, companyId: 2, proofreaderId: 3 }); // 编辑甲的书
  deliverTask(db, id, 2);
  assert.throws(() => confirmDeliveryReceipt(db, id, 6), (e: unknown) => errCode(e) === "FORBIDDEN"); // 编辑乙
  assert.throws(() => confirmDeliveryReceipt(db, id, 2), (e: unknown) => errCode(e) === "FORBIDDEN"); // 外校主管
  assert.throws(() => confirmDeliveryReceipt(db, id, 3), (e: unknown) => errCode(e) === "FORBIDDEN"); // 校对人员
  db.close();
});

test("25. 没有 deliveries 记录的稿件不能确认", () => {
  const db = freshDb();
  const id = toCompleted(db, { operatorId: 1, companyId: 2, proofreaderId: 3 }); // 尚未送达
  assert.throws(() => confirmDeliveryReceipt(db, id, 1), (e: unknown) => errCode(e) === "INVALID_STATUS");
  db.close();
});

test("26. 重复确认不产生第二条记录（服务幂等 + UNIQUE 兜底）", () => {
  const db = freshDb();
  const id = toCompleted(db, { operatorId: 1, companyId: 2, proofreaderId: 3 });
  deliverTask(db, id, 2);
  assert.strictEqual(confirmDeliveryReceipt(db, id, 1), "confirmed");
  assert.strictEqual(confirmDeliveryReceipt(db, id, 1), "already_confirmed");
  const deliveryId = (db.prepare("SELECT id FROM deliveries WHERE task_id = ?").get(id) as { id: number }).id;
  // 绕过服务层直接插入同 delivery_id → 被 UNIQUE 约束拒绝
  assert.throws(() =>
    db.prepare("INSERT INTO delivery_receipts(delivery_id, confirmed_by, confirmed_at) VALUES (?,?,?)").run(deliveryId, 1, new Date().toISOString()),
  );
  const c = (db.prepare("SELECT COUNT(*) c FROM delivery_receipts WHERE delivery_id = ?").get(deliveryId) as { c: number }).c;
  assert.strictEqual(c, 1);
  db.close();
});

test("27. 确认收到后从已送达未确认中立即消失，送达记录保留", () => {
  const db = freshDb();
  const id = toCompleted(db, { operatorId: 1, companyId: 2, proofreaderId: 3 });
  deliverTask(db, id, 2);
  const cutoff = new Date(0).toISOString();
  assert.ok(listDeliveredUnconfirmedByEditor(db, 1, cutoff).some((t) => t.id === id));
  confirmDeliveryReceipt(db, id, 1);
  assert.ok(!listDeliveredUnconfirmedByEditor(db, 1, cutoff).some((t) => t.id === id));
  assert.strictEqual((db.prepare("SELECT COUNT(*) c FROM deliveries WHERE task_id = ?").get(id) as { c: number }).c, 1);
  db.close();
});

test("28. delivery_receipts 只追加，UPDATE 与 DELETE 被拒绝", () => {
  const db = freshDb();
  const id = toCompleted(db, { operatorId: 1, companyId: 2, proofreaderId: 3 });
  deliverTask(db, id, 2);
  confirmDeliveryReceipt(db, id, 1);
  assert.throws(() => db.prepare("UPDATE delivery_receipts SET confirmed_by = 2 WHERE id = 1").run());
  assert.throws(() => db.prepare("DELETE FROM delivery_receipts WHERE id = 1").run());
  db.close();
});

test("29. 确认收到不影响状态、完成量、搜索与历史", () => {
  const db = freshDb();
  const id = toCompleted(db, { operatorId: 1, title: "确认统计书", companyId: 2, proofreaderId: 3 });
  deliverTask(db, id, 2);
  const completedBefore = countCompleted(db);
  const eventsBefore = (db.prepare("SELECT COUNT(*) c FROM task_events WHERE task_id = ?").get(id) as { c: number }).c;
  confirmDeliveryReceipt(db, id, 1);
  assert.strictEqual((db.prepare("SELECT status FROM tasks WHERE id = ?").get(id) as { status: string }).status, "COMPLETED");
  assert.strictEqual(countCompleted(db), completedBefore);
  assert.strictEqual((db.prepare("SELECT COUNT(*) c FROM task_events WHERE task_id = ?").get(id) as { c: number }).c, eventsBefore);
  assert.ok(searchBooks(db, "确认统计书", 1, 20).results.some((x) => x.title === "确认统计书"));
  assert.ok(listCompletedByEditor(db, 1).some((t) => t.id === id));
  db.close();
});

test("30. 第8天自动隐藏且不自动生成确认记录", () => {
  const db = freshDb();
  const id = toCompleted(db, { operatorId: 1, title: "边界确认", companyId: 2, proofreaderId: 3 });
  // 送达时间：上海 8月1日 12:00 = UTC 08-01T04:00
  insertDelivery(db, id, 2, "2026-08-01T04:00:00Z");
  const cutoffDay8 = new Date(recentDeliveryCutoffMs(new Date("2026-08-07T16:00:00Z"))).toISOString(); // 上海 8月8日
  assert.ok(!listDeliveredUnconfirmedByEditor(db, 1, cutoffDay8).some((t) => t.id === id));
  const c = (
    db
      .prepare("SELECT COUNT(*) c FROM delivery_receipts WHERE delivery_id = (SELECT id FROM deliveries WHERE task_id = ?)")
      .get(id) as { c: number }
  ).c;
  assert.strictEqual(c, 0);
  db.close();
});
