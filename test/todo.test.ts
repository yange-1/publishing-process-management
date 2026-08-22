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
import { listMyTodos, type TodoUser } from "../lib/todo-service.ts";

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

const U: Record<string, TodoUser> = {
  editor1: { id: 1, role: "RESPONSIBLE_EDITOR", companyId: 1 },
  sup1: { id: 2, role: "EXTERNAL_SUPERVISOR", companyId: 2 },
  pf1: { id: 3, role: "PROOFREADER", companyId: 2 },
  admin: { id: 4, role: "INTERNAL_ADMIN", companyId: 1 },
  pf2: { id: 5, role: "PROOFREADER", companyId: 2 },
  editor2: { id: 6, role: "RESPONSIBLE_EDITOR", companyId: 1 },
  sup2: { id: 7, role: "EXTERNAL_SUPERVISOR", companyId: 3 },
  pf3: { id: 8, role: "PROOFREADER", companyId: 3 },
};

function publish(
  db: Database.Database,
  opts: { editorId?: number; title?: string; stage?: string; starLevel?: number; companyId?: number } = {},
): number {
  return publishTask(db, {
    operatorId: opts.editorId ?? 1,
    bookTitle: opts.title ?? "书",
    stage: opts.stage ?? "INITIAL_REVIEW",
    starLevel: opts.starLevel ?? 1,
    companyId: opts.companyId ?? 2,
  });
}

function confirm(db: Database.Database, taskId: number, companyId: number): void {
  confirmReceipt(db, taskId, companyId === 3 ? 7 : 2);
}

function toReady(db: Database.Database, opts = {}): number {
  const id = publish(db, opts);
  confirm(db, id, (opts as { companyId?: number }).companyId ?? 2);
  return id;
}

function toInProgress(db: Database.Database, opts = {}, proofreaderId = 3): number {
  const id = toReady(db, opts);
  startTask(db, id, proofreaderId);
  return id;
}

function toCompleted(db: Database.Database, opts = {}, proofreaderId = 3): number {
  const id = toInProgress(db, opts, proofreaderId);
  finishTask(db, id, proofreaderId);
  return id;
}

function agePublished(db: Database.Database, taskId: number, daysAgo: number): void {
  const past = new Date(Date.now() - daysAgo * 86400000).toISOString();
  db.prepare("UPDATE tasks SET published_at = ? WHERE id = ?").run(past, taskId);
}

test("1. 责任编辑看到自己发布的待确认任务（waiting）", () => {
  const db = freshDb();
  const id = publish(db, { title: "待确认" });
  const s = listMyTodos(db, U.editor1);
  assert.deepStrictEqual(s.items.map((i) => i.id), [id]);
  assert.strictEqual(s.items[0].group, "waiting");
  assert.strictEqual(s.activeCount, 1);
  assert.strictEqual(s.completedCount, 0);
  db.close();
});

test("2. 待开始任务为 waiting 分组", () => {
  const db = freshDb();
  toReady(db, { title: "待开始" });
  const s = listMyTodos(db, U.editor1);
  assert.strictEqual(s.items[0].group, "waiting");
  assert.strictEqual(s.activeCount, 1);
  db.close();
});

test("3. 进行中任务为 in_progress 分组", () => {
  const db = freshDb();
  toInProgress(db, { title: "进行中" });
  const s = listMyTodos(db, U.pf1);
  assert.strictEqual(s.items[0].group, "in_progress");
  assert.strictEqual(s.activeCount, 1);
  db.close();
});

test("4. 已完成任务为 completed 分组，不计入 activeCount", () => {
  const db = freshDb();
  toCompleted(db, { title: "已完成" });
  const s = listMyTodos(db, U.pf1);
  assert.strictEqual(s.items[0].group, "completed");
  assert.strictEqual(s.activeCount, 0);
  assert.strictEqual(s.completedCount, 1);
  db.close();
});

test("5. 超过阈值的活动任务进入 urgent 分组", () => {
  const db = freshDb();
  const id = toReady(db, { title: "滞留", stage: "FIRST_PROOF", starLevel: 1 });
  agePublished(db, id, 40); // 非初审一星阈值 30 天
  const s = listMyTodos(db, U.editor1);
  assert.strictEqual(s.items[0].group, "urgent");
  assert.strictEqual(s.urgentCount, 1);
  assert.strictEqual(s.items[0].overdueDays, 10);
  db.close();
});

test("6. 已取消任务不出现在待办", () => {
  const db = freshDb();
  const id = publish(db, { title: "取消" });
  cancelTask(db, id, 4, "误发");
  const s = listMyTodos(db, U.editor1);
  assert.strictEqual(s.items.length, 0);
  assert.strictEqual(s.activeCount, 0);
  db.close();
});

test("7. 责任编辑只看到自己书稿的任务", () => {
  const db = freshDb();
  const mine = publish(db, { editorId: 1, title: "我的" });
  publish(db, { editorId: 6, title: "别人的" });
  const s = listMyTodos(db, U.editor1);
  assert.deepStrictEqual(s.items.map((i) => i.id), [mine]);
  db.close();
});

test("8. 外校主管只看到本公司任务", () => {
  const db = freshDb();
  const a = publish(db, { title: "外校A任务", companyId: 2 });
  publish(db, { title: "外校B任务", companyId: 3 });
  const s = listMyTodos(db, U.sup1);
  assert.deepStrictEqual(s.items.map((i) => i.id), [a]);
  db.close();
});

test("9. 校对人员只看到本公司待开始 + 本人进行中/已完成", () => {
  const db = freshDb();
  const ready = toReady(db, { title: "本司待开始" }); // 外校A
  const mine = toCompleted(db, { title: "本人完成" }, 3); // 校对甲本人
  toInProgress(db, { title: "他人进行中" }, 5); // 校对乙进行中，不应出现
  toReady(db, { title: "外校B待开始", companyId: 3 }); // 外校B，不应出现

  const s = listMyTodos(db, U.pf1);
  assert.deepStrictEqual(
    s.items.map((i) => i.id).sort((a, b) => a - b),
    [ready, mine].sort((a, b) => a - b),
  );
  db.close();
});

test("10. 超级管理员看到所有未取消任务", () => {
  const db = freshDb();
  const a = publish(db, { editorId: 1, title: "A" });
  const b = publish(db, { editorId: 6, title: "B", companyId: 3 });
  const c = toCompleted(db, { title: "C" }, 3);
  const cancelled = publish(db, { title: "取消" });
  cancelTask(db, cancelled, 4, "误发");
  const s = listMyTodos(db, U.admin);
  assert.deepStrictEqual(
    s.items.map((i) => i.id).sort((x, y) => x - y),
    [a, b, c].sort((x, y) => x - y),
  );
  db.close();
});

test("11. 外校主管待确认任务的行动提示为请确认收稿", () => {
  const db = freshDb();
  publish(db, { title: "待确认" });
  const s = listMyTodos(db, U.sup1);
  assert.strictEqual(s.items[0].actionHint, "请确认收稿");
  db.close();
});

test("12. 校对人员待开始任务提示可开始/被占用", () => {
  const db = freshDb();
  const ready = toReady(db, { title: "待开始" });
  let s = listMyTodos(db, U.pf1);
  assert.strictEqual(
    s.items.find((i) => i.id === ready)?.actionHint,
    "可开始校对",
  );

  toInProgress(db, { title: "占用" }, 3); // 校对甲已有进行中任务
  s = listMyTodos(db, U.pf1);
  assert.strictEqual(
    s.items.find((i) => i.id === ready)?.actionHint,
    "你已有正在校对的任务，请先完成当前任务",
  );
  db.close();
});

test("13. activeCount 与 completedCount 分别统计", () => {
  const db = freshDb();
  const urgent = toReady(db, { title: "滞留", stage: "FIRST_PROOF", starLevel: 1 });
  agePublished(db, urgent, 40);
  publish(db, { title: "待确认" });
  toCompleted(db, { title: "完成" }, 3);
  const s = listMyTodos(db, U.editor1);
  assert.strictEqual(s.urgentCount, 1);
  assert.strictEqual(s.waitingCount, 1);
  assert.strictEqual(s.inProgressCount, 0);
  assert.strictEqual(s.activeCount, 2);
  assert.strictEqual(s.completedCount, 1);
  db.close();
});

test("14. 待办按分组排序：urgent → waiting → in_progress → completed", () => {
  const db = freshDb();
  toCompleted(db, { title: "已完成" }, 3);
  const urgent = toReady(db, { title: "滞留", stage: "FIRST_PROOF", starLevel: 1 });
  agePublished(db, urgent, 40);
  publish(db, { title: "待确认" });
  toInProgress(db, { title: "进行中" }, 5);

  const s = listMyTodos(db, U.admin);
  assert.deepStrictEqual(
    s.items.map((i) => i.group),
    ["urgent", "waiting", "in_progress", "completed"],
  );
  db.close();
});

test("15. 我的待办页服务端回查当前用户，不信任浏览器角色", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "app", "tasks", "my-todos", "page.tsx"),
    "utf-8",
  );
  assert.ok(src.includes("requireCurrentUser"));
  assert.ok(!src.includes("useSearchParams"));
  assert.ok(!src.includes('"use client"'));
});

test("16. 首页含我的待办入口", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "app", "page.tsx"), "utf-8");
  assert.ok(src.includes("/tasks/my-todos"));
});

test("17. 待办测试不污染正式数据库", () => {
  if (!fs.existsSync(FORMAL_PATH)) return;
  assert.deepStrictEqual(formalCounts(), FORMAL_BASELINE);
});
