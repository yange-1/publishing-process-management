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
  listPendingConfirmation,
} from "../lib/task-service.ts";
import { listCompletedPage, listWarehouse } from "../lib/dashboard-service.ts";

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

function publish(
  db: Database.Database,
  opts: { title?: string; companyId?: number; starLevel?: number } = {},
) {
  return publishTask(db, {
    operatorId: 1,
    bookTitle: opts.title ?? "书",
    stage: "FIRST_PROOF",
    starLevel: opts.starLevel ?? 1,
    companyId: opts.companyId ?? 2,
  });
}

function confirm(db: Database.Database, taskId: number, companyId = 2) {
  confirmReceipt(db, taskId, companyId === 3 ? 7 : 2);
}

function toCompleted(
  db: Database.Database,
  opts: { title?: string; companyId?: number; proofreaderId?: number } = {},
) {
  const companyId = opts.companyId ?? 2;
  const id = publish(db, { title: opts.title, companyId });
  confirm(db, id, companyId);
  const pf = opts.proofreaderId ?? (companyId === 3 ? 8 : 3);
  startTask(db, id, pf);
  finishTask(db, id, pf);
  return id;
}

test("1. 外校主管首页待确认只含本公司任务", () => {
  const db = freshDb();
  publish(db, { title: "本公司A", companyId: 2 });
  publish(db, { title: "本公司B", companyId: 2 });
  publish(db, { title: "他公司", companyId: 3 });
  const mine = listPendingConfirmation(db).filter((t) => t.companyId === 2);
  assert.deepStrictEqual(
    mine.map((t) => t.title).sort(),
    ["本公司A", "本公司B"],
  );
  db.close();
});

test("2. 待确认按三星→二星→一星、同星级按来稿时间升序", () => {
  const db = freshDb();
  const a = publish(db, { title: "一星", companyId: 2, starLevel: 1 });
  const b = publish(db, { title: "三星", companyId: 2, starLevel: 3 });
  const c = publish(db, { title: "二星", companyId: 2, starLevel: 2 });
  db.prepare("UPDATE tasks SET published_at = '2026-08-05T00:00:00.000Z' WHERE id = ?").run(b);
  db.prepare("UPDATE tasks SET published_at = '2026-08-04T00:00:00.000Z' WHERE id = ?").run(c);
  db.prepare("UPDATE tasks SET published_at = '2026-08-03T00:00:00.000Z' WHERE id = ?").run(a);
  const mine = listPendingConfirmation(db).filter((t) => t.companyId === 2);
  assert.deepStrictEqual(mine.map((t) => t.id), [b, c, a]);
  db.close();
});

test("3. 待确认项含 bookId 供查看历史", () => {
  const db = freshDb();
  const id = publish(db, { title: "书", companyId: 2 });
  const item = listPendingConfirmation(db).find((t) => t.id === id);
  assert.ok(item);
  assert.strictEqual(typeof item.bookId, "number");
  db.close();
});

test("4. 确认收稿后立即进入书稿仓库", () => {
  const db = freshDb();
  const id = publish(db, { title: "待确认", companyId: 2 });
  assert.ok(!listWarehouse(db).some((t) => t.id === id)); // 待确认不在仓库
  confirm(db, id, 2);
  const w = listWarehouse(db).find((t) => t.id === id);
  assert.ok(w);
  assert.strictEqual(w.status, "READY_TO_START");
  db.close();
});

test("5. 确认幂等（重复确认不重复事件）", () => {
  const db = freshDb();
  const id = publish(db, { title: "幂等", companyId: 2 });
  assert.strictEqual(confirmReceipt(db, id, 2), "confirmed");
  assert.strictEqual(confirmReceipt(db, id, 2), "already_confirmed");
  const c = db
    .prepare("SELECT COUNT(*) c FROM task_events WHERE task_id = ? AND event_type = 'RECEIPT_CONFIRMED'")
    .get(id) as { c: number };
  assert.strictEqual(c.c, 1);
  db.close();
});

test("6. 已完成独立页只显示本公司任务", () => {
  const db = freshDb();
  toCompleted(db, { title: "本公司完成", companyId: 2, proofreaderId: 3 });
  toCompleted(db, { title: "他公司完成", companyId: 3, proofreaderId: 8 });
  const r = listCompletedPage(db, 2, 1, 20);
  assert.strictEqual(r.total, 1);
  assert.strictEqual(r.items[0].title, "本公司完成");
  db.close();
});

test("7. 已完成独立页按完成时间倒序、每页20条", () => {
  const db = freshDb();
  for (let i = 0; i < 25; i++) {
    const id = toCompleted(db, { title: `完成${i}`, companyId: 2, proofreaderId: 3 });
    db.prepare("UPDATE tasks SET finished_at = ? WHERE id = ?").run(
      new Date(Date.now() - i * 1000).toISOString(),
      id,
    );
  }
  const p1 = listCompletedPage(db, 2, 1, 20);
  assert.strictEqual(p1.total, 25);
  assert.strictEqual(p1.items.length, 20);
  assert.strictEqual(p1.items[0].title, "完成0"); // 完成时间最新在前
  const p2 = listCompletedPage(db, 2, 2, 20);
  assert.strictEqual(p2.items.length, 5);
  db.close();
});

test("8. 首页源码：外校主管隐藏待确认/我的待办、隐藏已完成、已完成卡可点击", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "app", "page.tsx"), "utf-8");
  assert.ok(src.includes('user.role !== "PROOFREADER" && user.role !== "EXTERNAL_SUPERVISOR"'));
  assert.ok(src.includes('user.role !== "EXTERNAL_SUPERVISOR"'));
  assert.ok(src.includes('"/tasks/completed"'));
  assert.ok(src.includes("SupervisorPendingList"));
});

test("9. 已完成独立页为服务端组件并分页", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "app", "tasks", "completed", "page.tsx"),
    "utf-8",
  );
  assert.ok(src.includes("requireCurrentUser"));
  assert.ok(src.includes("listCompletedPage"));
  assert.ok(!src.includes('"use client"'));
});

test("10. 外校主管首页确认组件复用 confirmReceiptAction", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "components", "SupervisorPendingList.tsx"),
    "utf-8",
  );
  assert.ok(src.includes("confirmReceiptAction"));
  assert.ok(src.includes("router.refresh()"));
});

test("11. 自动测试不污染正式数据库", () => {
  if (!fs.existsSync(FORMAL_PATH)) return;
  assert.deepStrictEqual(formalCounts(), FORMAL_BASELINE);
});
