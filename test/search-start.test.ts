import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  publishTask,
  confirmReceipt,
  startTask,
} from "../lib/task-service.ts";
import {
  proofreaderStartDecision,
  hasInProgressTask,
  searchBooks,
} from "../lib/search-service.ts";

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

function publish(db: Database.Database, opts: { title?: string; companyId?: number } = {}) {
  return publishTask(db, {
    operatorId: 1,
    bookTitle: opts.title ?? "书",
    stage: "FIRST_PROOF",
    starLevel: 1,
    companyId: opts.companyId ?? 2,
  });
}

function toReady(db: Database.Database, opts: { title?: string; companyId?: number } = {}) {
  const id = publish(db, opts);
  confirmReceipt(db, id, opts.companyId === 3 ? 7 : 2);
  return id;
}

test("1. 同公司、空闲、READY_TO_START 显示开始按钮", () => {
  const d = proofreaderStartDecision("PROOFREADER", "READY_TO_START", 2, 2, false);
  assert.deepStrictEqual(d, { showStart: true, showBusyHint: false });
});

test("2. 已有进行中任务时显示忙碌提示、不显示开始按钮", () => {
  const d = proofreaderStartDecision("PROOFREADER", "READY_TO_START", 2, 2, true);
  assert.deepStrictEqual(d, { showStart: false, showBusyHint: true });
});

test("3. 非本公司 READY_TO_START 不显示开始按钮", () => {
  const d = proofreaderStartDecision("PROOFREADER", "READY_TO_START", 3, 2, false);
  assert.deepStrictEqual(d, { showStart: false, showBusyHint: false });
});

test("4. 非 READY_TO_START 状态不显示开始按钮", () => {
  assert.deepStrictEqual(proofreaderStartDecision("PROOFREADER", "IN_PROGRESS", 2, 2, false), {
    showStart: false,
    showBusyHint: false,
  });
  assert.deepStrictEqual(proofreaderStartDecision("PROOFREADER", "COMPLETED", 2, 2, false), {
    showStart: false,
    showBusyHint: false,
  });
  assert.deepStrictEqual(proofreaderStartDecision("PROOFREADER", "PENDING_CONFIRMATION", 2, 2, false), {
    showStart: false,
    showBusyHint: false,
  });
});

test("5. 责任编辑、外校主管、Dominance 不显示开始按钮", () => {
  assert.deepStrictEqual(proofreaderStartDecision("RESPONSIBLE_EDITOR", "READY_TO_START", 2, 2, false), {
    showStart: false,
    showBusyHint: false,
  });
  assert.deepStrictEqual(proofreaderStartDecision("EXTERNAL_SUPERVISOR", "READY_TO_START", 2, 2, false), {
    showStart: false,
    showBusyHint: false,
  });
  assert.deepStrictEqual(proofreaderStartDecision("INTERNAL_ADMIN", "READY_TO_START", 2, 2, false), {
    showStart: false,
    showBusyHint: false,
  });
});

test("6. hasInProgressTask 服务端查询正确", () => {
  const db = freshDb();
  assert.strictEqual(hasInProgressTask(db, 3), false);
  const id = toReady(db, { title: "书" });
  startTask(db, id, 3); // 校对甲开始
  assert.strictEqual(hasInProgressTask(db, 3), true);
  assert.strictEqual(hasInProgressTask(db, 5), false);
  db.close();
});

test("7. searchBooks 返回 companyId 供开始判断", () => {
  const db = freshDb();
  publish(db, { title: "《外校A书》", companyId: 2 });
  const r = searchBooks(db, "外校A书", 1, 20);
  assert.strictEqual(r.results.length, 1);
  assert.strictEqual(r.results[0].companyId, 2);
  db.close();
});

test("8. 搜索页为服务端组件，复用 startTaskAction 与决策函数", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "app", "search", "page.tsx"), "utf-8");
  assert.ok(src.includes("requireCurrentUser"));
  assert.ok(src.includes("proofreaderStartDecision"));
  assert.ok(src.includes("hasInProgressTask"));
  assert.ok(src.includes("SearchStartActions"));
  assert.ok(!src.includes('"use client"'));
});

test("9. 开始按钮组件复用 startTaskAction", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "components", "SearchStartActions.tsx"),
    "utf-8",
  );
  assert.ok(src.includes("startTaskAction"));
  assert.ok(src.includes("router.refresh()"));
});

test("10. 搜索开始测试不污染正式数据库", () => {
  if (!fs.existsSync(FORMAL_PATH)) return;
  assert.deepStrictEqual(formalCounts(), FORMAL_BASELINE);
});
