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
import {
  listWarehouse,
  listProductionByEditor,
  listCompletedByEditor,
  countActiveBooksByEditor,
  countWarehouseByCompany,
} from "../lib/dashboard-service.ts";

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
  opts: { operatorId?: number; title?: string; companyId?: number; starLevel?: number } = {},
) {
  return publishTask(db, {
    operatorId: opts.operatorId ?? 1,
    bookTitle: opts.title ?? "书",
    stage: "FIRST_PROOF",
    starLevel: opts.starLevel ?? 1,
    companyId: opts.companyId ?? 2,
  });
}

function confirm(db: Database.Database, taskId: number, companyId = 2) {
  confirmReceipt(db, taskId, companyId === 3 ? 7 : 2);
}

function toReady(db: Database.Database, opts: { operatorId?: number; title?: string; companyId?: number } = {}) {
  const id = publish(db, opts);
  confirm(db, id, opts.companyId ?? 2);
  return id;
}

function toInProgress(
  db: Database.Database,
  opts: { operatorId?: number; title?: string; companyId?: number; proofreaderId?: number } = {},
) {
  const companyId = opts.companyId ?? 2;
  const id = toReady(db, { operatorId: opts.operatorId, title: opts.title, companyId });
  startTask(db, id, opts.proofreaderId ?? (companyId === 3 ? 8 : 3));
  return id;
}

function toCompleted(
  db: Database.Database,
  opts: { operatorId?: number; title?: string; companyId?: number; proofreaderId?: number } = {},
) {
  const companyId = opts.companyId ?? 2;
  const pf = opts.proofreaderId ?? (companyId === 3 ? 8 : 3);
  const id = toInProgress(db, { operatorId: opts.operatorId, title: opts.title, companyId, proofreaderId: pf });
  finishTask(db, id, pf);
  return id;
}

test("1. 部门仓库显示 A 和 B 的 READY_TO_START 任务", () => {
  const db = freshDb();
  const a = toReady(db, { operatorId: 1, title: "A的" });
  const b = toReady(db, { operatorId: 6, title: "B的" });
  const ids = listWarehouse(db).map((t) => t.id);
  assert.ok(ids.includes(a) && ids.includes(b));
  db.close();
});

test("2. 我的生产线只含本人 IN_PROGRESS", () => {
  const db = freshDb();
  const mine = toInProgress(db, { operatorId: 1, title: "我的进行中", proofreaderId: 3 });
  toInProgress(db, { operatorId: 6, title: "别人的进行中", proofreaderId: 5 });
  const r = listProductionByEditor(db, 1);
  assert.deepStrictEqual(r.map((t) => t.id), [mine]);
  db.close();
});

test("3. 我的已完成只含本人 COMPLETED", () => {
  const db = freshDb();
  const mine = toCompleted(db, { operatorId: 1, title: "我的完成", proofreaderId: 3 });
  toCompleted(db, { operatorId: 6, title: "别人的完成", proofreaderId: 5 });
  const r = listCompletedByEditor(db, 1);
  assert.deepStrictEqual(r.map((t) => t.id), [mine]);
  db.close();
});

test("4. 我的现有书稿为本人活动书稿去重计数", () => {
  const db = freshDb();
  // 编辑甲 1 本书处于待确认，1 本书待开始，1 本书进行中；编辑乙 1 本书待开始
  publish(db, { operatorId: 1, title: "甲待确认" });
  toReady(db, { operatorId: 1, title: "甲待开始" });
  toInProgress(db, { operatorId: 1, title: "甲进行中", proofreaderId: 3 });
  toReady(db, { operatorId: 6, title: "乙待开始" });
  assert.strictEqual(countActiveBooksByEditor(db, 1), 3);
  assert.strictEqual(countActiveBooksByEditor(db, 6), 1);
  db.close();
});

test("5. 仓库显示各外校公司数量", () => {
  const db = freshDb();
  toReady(db, { operatorId: 1, title: "A1", companyId: 2 });
  toReady(db, { operatorId: 1, title: "A2", companyId: 2 });
  toReady(db, { operatorId: 1, title: "B1", companyId: 3 });
  const counts = countWarehouseByCompany(db);
  const a = counts.find((c) => c.companyId === 2);
  const b = counts.find((c) => c.companyId === 3);
  assert.strictEqual(a?.count, 2);
  assert.strictEqual(b?.count, 1);
  db.close();
});

test("6. 仓库可按接收外校公司筛选", () => {
  const db = freshDb();
  const a = toReady(db, { operatorId: 1, title: "A", companyId: 2 });
  toReady(db, { operatorId: 1, title: "B", companyId: 3 });
  const filtered = listWarehouse(db).filter((t) => t.companyId === 2);
  assert.deepStrictEqual(filtered.map((t) => t.id), [a]);
  db.close();
});

test("7. 责任编辑待确认只统计本人书稿", () => {
  const db = freshDb();
  publish(db, { operatorId: 1, title: "甲待确认" });
  publish(db, { operatorId: 6, title: "乙待确认" });
  const mine = listPendingConfirmation(db).filter((t) => t.editorId === 1);
  assert.deepStrictEqual(mine.map((t) => t.title), ["甲待确认"]);
  db.close();
});

test("8. Dominance 代发布归属目标责任编辑", () => {
  const db = freshDb();
  const id = publishTask(db, {
    operatorId: 4, // 管理员
    bookTitle: "代发布书",
    stage: "INITIAL_REVIEW",
    starLevel: 1,
    companyId: 2,
    editorId: 6, // 目标编辑乙
    proxyReason: "代发布",
  });
  const book = db.prepare("SELECT editor_id FROM tasks t JOIN books b ON b.id=t.book_id WHERE t.id=?").get(id) as { editor_id: number };
  assert.strictEqual(book.editor_id, 6);
  db.close();
});

test("9. 首页源码含责任编辑角色化查询与部门仓库", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "app", "page.tsx"), "utf-8");
  assert.ok(src.includes("listProductionByEditor"));
  assert.ok(src.includes("listCompletedByEditor"));
  assert.ok(src.includes("countActiveBooksByEditor"));
  assert.ok(src.includes("countWarehouseByCompany"));
  assert.ok(src.includes("前方还有 {warehouseForDisplay.length} 份待制作"));
  assert.ok(src.includes("“备餐”中，请耐心等待～"));
  assert.ok(src.includes("我的已完成"));
});

test("10. 责任编辑仓库筛选联动：全部/A/B/清除 数量正确", () => {
  const db = freshDb();
  // 演示数据：A公司(companyId=2) 5 份、B公司(companyId=3) 2 份待开始稿件
  for (let i = 0; i < 5; i++) toReady(db, { operatorId: 1, title: `A${i}`, companyId: 2 });
  for (let i = 0; i < 2; i++) toReady(db, { operatorId: 1, title: `B${i}`, companyId: 3 });
  const warehouse = listWarehouse(db);
  // 复刻首页 warehouseForDisplay 的筛选口径（不新增查询、不改统计口径）
  const display = (companyFilter: number | null) =>
    companyFilter != null ? warehouse.filter((t) => t.companyId === companyFilter) : warehouse;
  assert.strictEqual(display(null).length, 7); // 全部外校公司
  assert.strictEqual(display(2).length, 5); // 演示外校公司A
  assert.strictEqual(display(3).length, 2); // 演示外校公司B
  assert.strictEqual(display(null).length, 7); // 清除后恢复总数
  db.close();
});

test("11. 自动测试不污染正式数据库", () => {
  if (!fs.existsSync(FORMAL_PATH)) return;
  assert.deepStrictEqual(formalCounts(), FORMAL_BASELINE);
});
