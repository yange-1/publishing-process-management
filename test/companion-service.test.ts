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
} from "../lib/task-service.ts";
import { deliverTask, confirmDeliveryReceipt } from "../lib/delivery-service.ts";
import { listCompanionManuscripts } from "../lib/companion-service.ts";

const SCHEMA = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");

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
      (6, 'editor2', '编辑乙', 'RESPONSIBLE_EDITOR', 1),
      (2, 'sup1', '主管甲', 'EXTERNAL_SUPERVISOR', 2),
      (3, 'pf1', '校对甲', 'PROOFREADER', 2)`,
  ).run();
  return db;
}

type Pub = { operatorId?: number; title?: string; stage?: string; starLevel?: number; companyId?: number };

function publish(db: Database.Database, opts: Pub = {}): number {
  return publishTask(db, {
    operatorId: opts.operatorId ?? 1,
    bookTitle: opts.title ?? "书",
    stage: opts.stage ?? "FIRST_PROOF",
    starLevel: opts.starLevel ?? 1,
    companyId: opts.companyId ?? 2,
  });
}
function toReady(db: Database.Database, opts: Pub = {}): number {
  const id = publish(db, opts);
  confirmReceipt(db, id, 2);
  return id;
}
function toInProgress(db: Database.Database, opts: Pub = {}): number {
  const id = toReady(db, opts);
  startTask(db, id, 3);
  return id;
}
function toCompleted(db: Database.Database, opts: Pub = {}): number {
  const id = toInProgress(db, opts);
  finishTask(db, id, 3);
  return id;
}
function agePublished(db: Database.Database, taskId: number, daysAgo: number): void {
  db.prepare("UPDATE tasks SET published_at = ? WHERE id = ?").run(
    new Date(Date.now() - daysAgo * 86400000).toISOString(),
    taskId,
  );
}

test("1. PENDING 映射 queued，stage/title 正确", () => {
  const db = freshDb();
  const id = publish(db, { title: "待确认书" });
  const item = listCompanionManuscripts(db, 1, new Date()).find((m) => m.manuscriptId === String(id));
  assert.ok(item);
  assert.strictEqual(item.state, "queued");
  assert.strictEqual(item.stage, "FIRST_PROOF");
  assert.strictEqual(item.title, "待确认书");
  db.close();
});

test("2. READY_TO_START 映射 queued", () => {
  const db = freshDb();
  const id = toReady(db, { title: "待开始书" });
  const item = listCompanionManuscripts(db, 1, new Date()).find((m) => m.manuscriptId === String(id));
  assert.strictEqual(item?.state, "queued");
  db.close();
});

test("3. IN_PROGRESS 映射 proofreading", () => {
  const db = freshDb();
  const id = toInProgress(db, { title: "进行中书" });
  const item = listCompanionManuscripts(db, 1, new Date()).find((m) => m.manuscriptId === String(id));
  assert.strictEqual(item?.state, "proofreading");
  db.close();
});

test("4. 活动任务达到阈值后 overdue 覆盖 queued", () => {
  const db = freshDb();
  const id = publish(db, { title: "滞留书", starLevel: 1 });
  agePublished(db, id, 40); // 非初审一星阈值 30 天
  const item = listCompanionManuscripts(db, 1, new Date()).find((m) => m.manuscriptId === String(id));
  assert.strictEqual(item?.state, "overdue");
  db.close();
});

test("5. 活动任务达到阈值后 overdue 覆盖 proofreading", () => {
  const db = freshDb();
  const id = toInProgress(db, { title: "滞留进行中", starLevel: 1 });
  agePublished(db, id, 40);
  const item = listCompanionManuscripts(db, 1, new Date()).find((m) => m.manuscriptId === String(id));
  assert.strictEqual(item?.state, "overdue");
  db.close();
});

test("6. 配送中（COMPLETED 无送达）映射 delivering", () => {
  const db = freshDb();
  const id = toCompleted(db, { title: "配送中书" });
  const item = listCompanionManuscripts(db, 1, new Date()).find((m) => m.manuscriptId === String(id));
  assert.strictEqual(item?.state, "delivering");
  db.close();
});

test("7. 已取消任务不返回", () => {
  const db = freshDb();
  const id = publish(db, { title: "取消书" });
  cancelTask(db, id, 1, "误发");
  assert.ok(!listCompanionManuscripts(db, 1, new Date()).some((m) => m.manuscriptId === String(id)));
  db.close();
});

test("8. 已送达未确认映射 delivered", () => {
  const db = freshDb();
  const id = toCompleted(db, { title: "已送达书" });
  deliverTask(db, id, 2);
  const item = listCompanionManuscripts(db, 1, new Date()).find((m) => m.manuscriptId === String(id));
  assert.ok(item);
  assert.strictEqual(item.state, "delivered");
  db.close();
});

test("8b. delivered 使用真实送达时间，不写入当前时间", () => {
  const db = freshDb();
  const id = toCompleted(db, { title: "已送达书" });
  deliverTask(db, id, 2);
  const deliveredAt = (
    db.prepare("SELECT delivered_at FROM deliveries WHERE task_id = ?").get(id) as {
      delivered_at: string;
    }
  ).delivered_at;
  const item = listCompanionManuscripts(db, 1, new Date()).find((m) => m.manuscriptId === String(id));
  assert.ok(item);
  assert.strictEqual(item.updatedAt, deliveredAt);
  db.close();
});

test("9. 已确认收货不返回", () => {
  const db = freshDb();
  const id = toCompleted(db, { title: "已确认书" });
  deliverTask(db, id, 2);
  confirmDeliveryReceipt(db, id, 1);
  assert.ok(!listCompanionManuscripts(db, 1, new Date()).some((m) => m.manuscriptId === String(id)));
  db.close();
});

test("10. 两名责任编辑数据完全隔离", () => {
  const db = freshDb();
  toReady(db, { operatorId: 1, title: "甲的书" });
  toReady(db, { operatorId: 6, title: "乙的书" });
  const a = listCompanionManuscripts(db, 1, new Date());
  const b = listCompanionManuscripts(db, 6, new Date());
  assert.ok(a.some((m) => m.title === "甲的书"));
  assert.ok(!a.some((m) => m.title === "乙的书"));
  assert.ok(b.some((m) => m.title === "乙的书"));
  assert.ok(!b.some((m) => m.title === "甲的书"));
  db.close();
});

test("11. 同一本书不同校次使用不同 task.id 分别返回", () => {
  const db = freshDb();
  db.prepare("INSERT INTO books(id, title, editor_id) VALUES (1, '多校次书', 1)").run();
  db.prepare(
    "INSERT INTO tasks(id, book_id, stage, work_type, star_level, status, publisher_id, published_at) VALUES (1, 1, 'FIRST_PROOF', 'PROOFREAD', 1, 'READY_TO_START', 1, '2026-08-01T00:00:00.000Z')",
  ).run();
  db.prepare(
    "INSERT INTO tasks(id, book_id, stage, work_type, star_level, status, publisher_id, published_at, started_at) VALUES (2, 1, 'SECOND_PROOF', 'PROOFREAD', 1, 'IN_PROGRESS', 1, '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z')",
  ).run();
  const list = listCompanionManuscripts(db, 1, new Date());
  const f = list.find((m) => m.manuscriptId === "1");
  const s = list.find((m) => m.manuscriptId === "2");
  assert.ok(f && s);
  assert.strictEqual(f.stage, "FIRST_PROOF");
  assert.strictEqual(s.stage, "SECOND_PROOF");
  assert.notStrictEqual(f.manuscriptId, s.manuscriptId);
  assert.strictEqual(f.title, "多校次书");
  assert.strictEqual(s.title, "多校次书");
  db.close();
});

test("12. updatedAt 多次请求保持稳定", () => {
  const db = freshDb();
  const id = toInProgress(db, { title: "稳定书" });
  const now = new Date();
  const a = listCompanionManuscripts(db, 1, now).find((m) => m.manuscriptId === String(id));
  const b = listCompanionManuscripts(db, 1, now).find((m) => m.manuscriptId === String(id));
  assert.ok(a && b);
  assert.strictEqual(a.updatedAt, b.updatedAt);
  db.close();
});

test("13. 不产生数据库写入", () => {
  const db = freshDb();
  toInProgress(db, { title: "无写入书" });
  const before = (db.prepare("SELECT COUNT(*) c FROM tasks").get() as { c: number }).c;
  listCompanionManuscripts(db, 1, new Date());
  const after = (db.prepare("SELECT COUNT(*) c FROM tasks").get() as { c: number }).c;
  assert.strictEqual(before, after);
  db.close();
});

test("14. 排序稳定且无重复：overdue 优先，无重复 task.id", () => {
  const db = freshDb();
  publish(db, { title: "排队", starLevel: 1 });
  const overdue = publish(db, { title: "滞留", starLevel: 1 });
  agePublished(db, overdue, 40);
  const list = listCompanionManuscripts(db, 1, new Date());
  assert.strictEqual(list[0].state, "overdue");
  const ids = list.map((m) => m.manuscriptId);
  assert.strictEqual(new Set(ids).size, ids.length);
  db.close();
});
