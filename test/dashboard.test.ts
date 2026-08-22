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
  listPendingConfirmation,
} from "../lib/task-service.ts";
import {
  listWarehouse,
  listProduction,
  listCompleted,
  listOverdue,
  countActiveBooks,
  countWarehouse,
  countProduction,
  countCompleted,
  waitDays,
  overdueThresholdDays,
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
    "INSERT INTO companies(id, name, type) VALUES (1, '社内', 'INTERNAL'), (2, '外校A', 'EXTERNAL')",
  ).run();
  db.prepare(
    `INSERT INTO users(id, username, display_name, role, company_id) VALUES
      (1, 'editor1', '编辑甲', 'RESPONSIBLE_EDITOR', 1),
      (2, 'sup1', '主管甲', 'EXTERNAL_SUPERVISOR', 2),
      (3, 'pf1', '校对甲', 'PROOFREADER', 2),
      (4, 'admin1', '管理员', 'INTERNAL_ADMIN', 1),
      (5, 'pf2', '校对乙', 'PROOFREADER', 2)`,
  ).run();
  return db;
}

function publish(
  db: Database.Database,
  opts: { title?: string; stage?: string; starLevel?: number } = {},
): number {
  return publishTask(db, {
    operatorId: 1,
    bookTitle: opts.title ?? "书",
    stage: opts.stage ?? "INITIAL_REVIEW",
    starLevel: opts.starLevel ?? 1,
    companyId: 2,
  });
}

function toReady(db: Database.Database, opts = {}): number {
  const id = publish(db, opts);
  confirmReceipt(db, id, 2);
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

test("1. PENDING_CONFIRMATION 不出现在仓库（只进入待确认专页）", () => {
  const db = freshDb();
  const id = publish(db, { title: "待确认" });
  assert.strictEqual(listWarehouse(db).length, 0);
  assert.deepStrictEqual(listPendingConfirmation(db).map((t) => t.id), [id]);
  db.close();
});

test("2. READY_TO_START出现在仓库", () => {
  const db = freshDb();
  const id = toReady(db, { title: "待开始" });
  assert.deepStrictEqual(listWarehouse(db).map((t) => t.id), [id]);
  db.close();
});

test("3. 确认后任务进入仓库（READY_TO_START）", () => {
  const db = freshDb();
  const id = publish(db);
  assert.strictEqual(listWarehouse(db).length, 0); // 待确认不在仓库
  confirmReceipt(db, id, 2);
  const w = listWarehouse(db);
  assert.deepStrictEqual(w.map((t) => t.id), [id]);
  assert.strictEqual(w[0].status, "READY_TO_START");
  db.close();
});

test("4. IN_PROGRESS不出现在仓库而出现在生产线", () => {
  const db = freshDb();
  const id = toInProgress(db, { title: "进行中" });
  assert.strictEqual(listWarehouse(db).length, 0);
  assert.deepStrictEqual(listProduction(db).map((t) => t.id), [id]);
  db.close();
});

test("5. COMPLETED只出现在已完成", () => {
  const db = freshDb();
  const id = toCompleted(db, { title: "已完成" });
  assert.strictEqual(listWarehouse(db).length, 0);
  assert.strictEqual(listProduction(db).length, 0);
  assert.deepStrictEqual(listCompleted(db).map((t) => t.id), [id]);
  db.close();
});

test("6. CANCELLED不计入当前统计", () => {
  const db = freshDb();
  const id = publish(db);
  cancelTask(db, id, 4, "误发");
  assert.strictEqual(listWarehouse(db).length, 0);
  assert.strictEqual(listProduction(db).length, 0);
  assert.strictEqual(listCompleted(db).length, 0);
  assert.strictEqual(countActiveBooks(db), 0);
  db.close();
});

test("7. 部门现有书稿数量正确", () => {
  const db = freshDb();
  publish(db, { title: "书A" });
  toReady(db, { title: "书B" });
  toInProgress(db, { title: "书C" }, 3);
  toCompleted(db, { title: "书D" }, 5);
  assert.strictEqual(countActiveBooks(db), 3); // A/B/C 各一本，D 已完成不计入
  db.close();
});

test("8. 仓库数量正确（仅 READY_TO_START）", () => {
  const db = freshDb();
  publish(db, { title: "A" }); // 待确认，不计入仓库
  toReady(db, { title: "B" }); // 待开始，计入仓库
  toInProgress(db, { title: "C" });
  assert.strictEqual(countWarehouse(db), 1);
  db.close();
});

test("9. 生产线数量正确", () => {
  const db = freshDb();
  toInProgress(db, { title: "A" }, 3);
  toInProgress(db, { title: "B" }, 5);
  assert.strictEqual(countProduction(db), 2);
  db.close();
});

test("10. 已完成数量正确", () => {
  const db = freshDb();
  toCompleted(db, { title: "A" });
  toCompleted(db, { title: "B" });
  assert.strictEqual(countCompleted(db), 2);
  db.close();
});

test("11. 仓库按星级和发布时间排序", () => {
  const db = freshDb();
  const a = toReady(db, { title: "一星", starLevel: 1 });
  const b = toReady(db, { title: "三星", starLevel: 3 });
  const c = toReady(db, { title: "二星", starLevel: 2 });
  assert.deepStrictEqual(listWarehouse(db).map((t) => t.id), [b, c, a]);
  // 同星级内按发布时间从早到晚
  db.prepare("UPDATE tasks SET star_level = 1 WHERE id IN (?, ?)").run(b, c);
  db.prepare("UPDATE tasks SET published_at = '2026-08-05T00:00:00.000Z' WHERE id = ?").run(b);
  db.prepare("UPDATE tasks SET published_at = '2026-08-04T00:00:00.000Z' WHERE id = ?").run(c);
  db.prepare("UPDATE tasks SET published_at = '2026-08-03T00:00:00.000Z' WHERE id = ?").run(a);
  assert.deepStrictEqual(listWarehouse(db).map((t) => t.id), [a, c, b]);
  db.close();
});

test("12. 仓库列表返回全部任务（页面最多显示20条）", () => {
  const db = freshDb();
  for (let i = 0; i < 21; i++) toReady(db, { title: `书${i}` });
  assert.strictEqual(listWarehouse(db).length, 21);
  db.close();
});

test("13. 超过20条时仓库完整列表仍返回全部", () => {
  const db = freshDb();
  for (let i = 0; i < 22; i++) toReady(db, { title: `书${i}` });
  assert.strictEqual(listWarehouse(db).length, 22);
  db.close();
});

test("14. 仓库完整查询返回全部任务", () => {
  const db = freshDb();
  publish(db, { title: "A" }); // 待确认，不在仓库
  toReady(db, { title: "B" });
  assert.strictEqual(listWarehouse(db).length, 1);
  db.close();
});

test("15. 已等待天数从published_at计算", () => {
  const now = new Date("2026-08-21T00:00:00.000Z");
  assert.strictEqual(waitDays("2026-08-11T00:00:00.000Z", now), 10);
  assert.strictEqual(waitDays("2026-08-21T00:00:00.000Z", now), 0);
});

test("16. 初审90天阈值正确", () => {
  assert.strictEqual(overdueThresholdDays("INITIAL_REVIEW", 1), 90);
});

test("17. 非初审一星30天阈值正确", () => {
  assert.strictEqual(overdueThresholdDays("FIRST_PROOF", 1), 30);
});

test("18. 非初审二星15天阈值正确", () => {
  assert.strictEqual(overdueThresholdDays("FIRST_PROOF", 2), 15);
});

test("19. 非初审三星7天阈值正确", () => {
  assert.strictEqual(overdueThresholdDays("FIRST_PROOF", 3), 7);
});

test("20. 新任务不会被误报为滞留", () => {
  const db = freshDb();
  publish(db, { title: "新任务" });
  assert.deepStrictEqual(listOverdue(db, new Date()), []);
  db.close();
});

test("21. 总控预警返回全部滞留任务（页面最多显示20条）", () => {
  const db = freshDb();
  const ids: number[] = [];
  for (let i = 0; i < 21; i++) {
    const id = publish(db, { title: `滞留${i}`, stage: "FIRST_PROOF", starLevel: 1 });
    agePublished(db, id, 40); // 超过30天阈值
    ids.push(id);
  }
  assert.strictEqual(listOverdue(db, new Date()).length, 21);
  db.close();
});

test("22. 首页不再使用演示数据", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "app", "page.tsx"), "utf-8");
  assert.ok(!src.includes("MOCK_PROJECTS"));
  assert.ok(!src.includes("components/projects"));
  assert.ok(!src.includes("components/WarehouseRow"));
  assert.ok(!src.includes("components/ProductionRow"));
  assert.ok(!src.includes("components/OverdueRow"));
});

test("23. 首页对所有登录用户开放查看（使用 requireCurrentUser）", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "app", "page.tsx"), "utf-8");
  assert.ok(src.includes("requireCurrentUser"));
  assert.ok(!src.includes("requireRole"));
});

test("24. 未登录用户仍受登录保护", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "app", "page.tsx"), "utf-8");
  assert.ok(src.includes("requireCurrentUser")); // requireCurrentUser 未登录会跳转 /login
});

test("25. 自动测试不污染正式数据库", () => {
  if (!fs.existsSync(FORMAL_PATH)) return;
  assert.deepStrictEqual(formalCounts(), FORMAL_BASELINE);
});

test("26. 首页待确认收稿入口仅对校对人员隐藏", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "app", "page.tsx"), "utf-8");
  assert.ok(src.includes('href="/tasks/pending-confirmation"'));
  assert.ok(src.includes('user.role !== "PROOFREADER"'));
});
