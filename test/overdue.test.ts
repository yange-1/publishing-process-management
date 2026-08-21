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
import {
  overdueThresholdDays,
  overdueInfo,
  listOverdue,
  listWarehouse,
  type DashboardTask,
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

const NOW = new Date("2026-08-22T00:00:00.000Z");

function mkTask(daysAgo: number, stage: string, starLevel: number): DashboardTask {
  return {
    id: 1,
    bookId: 1,
    title: "书",
    stage,
    workType: "PROOFREAD",
    starLevel,
    editorName: null,
    publisherCompanyName: null,
    companyName: null,
    companyId: null,
    publishedAt: new Date(NOW.getTime() - daysAgo * 86400000).toISOString(),
    status: "PENDING_CONFIRMATION",
    proofreaderId: null,
    proofreaderName: null,
    startedAt: null,
    finishedAt: null,
  };
}

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
      (4, 'admin1', '管理员', 'INTERNAL_ADMIN', 1)`,
  ).run();
  return db;
}

function publish(db: Database.Database, opts: { title?: string; stage?: string; starLevel?: number; workType?: string } = {}) {
  return publishTask(db, {
    operatorId: 1,
    bookTitle: opts.title ?? "书",
    stage: opts.stage ?? "INITIAL_REVIEW",
    starLevel: opts.starLevel ?? 1,
    workType: opts.workType,
    companyId: 2,
  });
}

function age(db: Database.Database, taskId: number, daysAgo: number): void {
  db.prepare("UPDATE tasks SET published_at = ? WHERE id = ?").run(
    new Date(NOW.getTime() - daysAgo * 86400000).toISOString(),
    taskId,
  );
}

test("1. 初审89天不滞留", () => {
  assert.strictEqual(overdueThresholdDays("INITIAL_REVIEW", 1), 90);
  assert.strictEqual(overdueInfo(mkTask(89, "INITIAL_REVIEW", 1), NOW).isOverdue, false);
});

test("2. 初审90天不滞留（等于阈值不算滞留）", () => {
  assert.strictEqual(overdueInfo(mkTask(90, "INITIAL_REVIEW", 1), NOW).isOverdue, false);
});

test("3. 初审91天滞留，超出1天", () => {
  const info = overdueInfo(mkTask(91, "INITIAL_REVIEW", 1), NOW);
  assert.strictEqual(info.isOverdue, true);
  assert.strictEqual(info.overdueDays, 1);
});

test("4. 非初审一星30天不滞留，31天滞留", () => {
  assert.strictEqual(overdueThresholdDays("FIRST_PROOF", 1), 30);
  assert.strictEqual(overdueInfo(mkTask(30, "FIRST_PROOF", 1), NOW).isOverdue, false);
  assert.strictEqual(overdueInfo(mkTask(31, "FIRST_PROOF", 1), NOW).isOverdue, true);
});

test("5. 非初审二星15天不滞留，16天滞留", () => {
  assert.strictEqual(overdueThresholdDays("FIRST_PROOF", 2), 15);
  assert.strictEqual(overdueInfo(mkTask(15, "FIRST_PROOF", 2), NOW).isOverdue, false);
  assert.strictEqual(overdueInfo(mkTask(16, "FIRST_PROOF", 2), NOW).isOverdue, true);
});

test("6. 非初审三星7天不滞留，8天滞留", () => {
  assert.strictEqual(overdueThresholdDays("FIRST_PROOF", 3), 7);
  assert.strictEqual(overdueInfo(mkTask(7, "FIRST_PROOF", 3), NOW).isOverdue, false);
  assert.strictEqual(overdueInfo(mkTask(8, "FIRST_PROOF", 3), NOW).isOverdue, true);
});

test("7. COMPLETED 不进入预警", () => {
  const db = freshDb();
  const id = publish(db);
  confirmReceipt(db, id, 2);
  startTask(db, id, 3);
  finishTask(db, id, 3);
  age(db, id, 100); // 远超阈值
  assert.deepStrictEqual(listOverdue(db, NOW), []);
  db.close();
});

test("8. CANCELLED 不进入预警", () => {
  const db = freshDb();
  const id = publish(db);
  cancelTask(db, id, 4, "误发");
  age(db, id, 100);
  assert.deepStrictEqual(listOverdue(db, NOW), []);
  db.close();
});

test("9. PENDING_CONFIRMATION 可以进入预警", () => {
  const db = freshDb();
  const id = publish(db);
  age(db, id, 91); // 初审超 90 天
  const r = listOverdue(db, NOW);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].id, id);
  db.close();
});

test("10. READY_TO_START 可以进入预警", () => {
  const db = freshDb();
  const id = publish(db);
  confirmReceipt(db, id, 2);
  age(db, id, 91);
  const r = listOverdue(db, NOW);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].status, "READY_TO_START");
  db.close();
});

test("11. IN_PROGRESS 可以进入预警", () => {
  const db = freshDb();
  const id = publish(db);
  confirmReceipt(db, id, 2);
  startTask(db, id, 3);
  age(db, id, 91);
  const r = listOverdue(db, NOW);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].status, "IN_PROGRESS");
  db.close();
});

test("12. 预警排序为三星、二星、一星（超出天数相同）", () => {
  const db = freshDb();
  const a = publish(db, { title: "一星", starLevel: 1 });
  const b = publish(db, { title: "三星", starLevel: 3 });
  const c = publish(db, { title: "二星", starLevel: 2 });
  age(db, a, 91);
  age(db, b, 91);
  age(db, c, 91);
  const r = listOverdue(db, NOW);
  assert.deepStrictEqual(r.map((x) => x.starLevel), [3, 2, 1]);
  db.close();
});

test("13. 同星级按发布时间从早到晚", () => {
  const db = freshDb();
  const a = publish(db, { title: "晚", starLevel: 1 });
  const b = publish(db, { title: "早", starLevel: 1 });
  age(db, a, 91); // 发布时间较晚（91天前）
  age(db, b, 92); // 发布时间较早（92天前）
  const r = listOverdue(db, NOW);
  assert.deepStrictEqual(r.map((x) => x.id), [b, a]); // 早的在前
  db.close();
});

test("14. 预警列表返回全部（页面最多显示20条）", () => {
  const db = freshDb();
  for (let i = 0; i < 25; i++) {
    const id = publish(db, { title: `书${i}` });
    age(db, id, 91);
  }
  assert.strictEqual(listOverdue(db, NOW).length, 25);
  db.close();
});

test("15. 预警总数不受20条展示上限影响", () => {
  const db = freshDb();
  for (let i = 0; i < 25; i++) {
    const id = publish(db, { title: `书${i}` });
    age(db, id, 91);
  }
  const all = listOverdue(db, NOW);
  assert.strictEqual(all.length, 25); // 总数，不是20
  assert.strictEqual(all.slice(0, 20).length, 20); // 展示截取20
  db.close();
});

test("16. 滞留任务仍保留在正常仓库列表", () => {
  const db = freshDb();
  const id = publish(db);
  age(db, id, 91);
  assert.ok(listOverdue(db, NOW).some((x) => x.id === id));
  assert.ok(listWarehouse(db).some((x) => x.id === id)); // 仍在仓库
  db.close();
});

test("17. 预警条目正确显示校次与工作内容", () => {
  const db = freshDb();
  const id = publish(db, { title: "核红书", stage: "FIRST_PROOF", starLevel: 1, workType: "RED_CHECK" });
  age(db, id, 31); // 非初审一星超30天
  const r = listOverdue(db, NOW);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].stage, "FIRST_PROOF");
  assert.strictEqual(r[0].workType, "RED_CHECK");
  db.close();
});

test("18. 首页统计函数均来自 SQLite（不使用演示数据）", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "app", "page.tsx"), "utf-8");
  assert.ok(!src.includes("MOCK_PROJECTS"));
  assert.ok(src.includes("listWarehouse"));
  assert.ok(src.includes("listOverdue"));
  assert.ok(src.includes("countActiveBooks"));
});

test("19. 不修改现有正式任务及历史事件", () => {
  if (!fs.existsSync(FORMAL_PATH)) return;
  assert.deepStrictEqual(formalCounts(), FORMAL_BASELINE);
});
