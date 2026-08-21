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
  nextStage,
  TaskServiceError,
  type TaskErrorCode,
} from "../lib/task-service.ts";
import { searchBooks, getBookDetail } from "../lib/search-service.ts";
import { WORK_TYPE_LABELS } from "../lib/dashboard-service.ts";

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
      (4, 'admin1', '管理员', 'INTERNAL_ADMIN', 1)`,
  ).run();
  return db;
}

function bookIdOf(db: Database.Database, taskId: number): number {
  return (db.prepare("SELECT book_id FROM tasks WHERE id = ?").get(taskId) as { book_id: number }).book_id;
}

function toCompleted(
  db: Database.Database,
  opts: { title?: string; stage?: string; editorId?: number } = {},
): { taskId: number; bookId: number } {
  const taskId = publishTask(db, {
    operatorId: opts.editorId ?? 1,
    bookTitle: opts.title ?? "书",
    stage: opts.stage ?? "INITIAL_REVIEW",
    starLevel: 1,
    companyId: 2,
  });
  confirmReceipt(db, taskId, 2);
  startTask(db, taskId, 3);
  finishTask(db, taskId, 3);
  return { taskId, bookId: bookIdOf(db, taskId) };
}

function rows(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c;
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

test("1. 新书稿默认工作内容为读校", () => {
  const db = freshDb();
  const taskId = publishTask(db, { operatorId: 1, bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 2 });
  const t = db.prepare("SELECT work_type FROM tasks WHERE id = ?").get(taskId) as { work_type: string };
  assert.strictEqual(t.work_type, "PROOFREAD");
  db.close();
});

test("2. 新书稿可以选择核红", () => {
  const db = freshDb();
  const taskId = publishTask(db, { operatorId: 1, bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 1, workType: "RED_CHECK", companyId: 2 });
  const t = db.prepare("SELECT work_type FROM tasks WHERE id = ?").get(taskId) as { work_type: string };
  assert.strictEqual(t.work_type, "RED_CHECK");
  db.close();
});

test("3. 新书稿可以选择读校且核红", () => {
  const db = freshDb();
  const taskId = publishTask(db, { operatorId: 1, bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 1, workType: "PROOFREAD_AND_RED_CHECK", companyId: 2 });
  const t = db.prepare("SELECT work_type FROM tasks WHERE id = ?").get(taskId) as { work_type: string };
  assert.strictEqual(t.work_type, "PROOFREAD_AND_RED_CHECK");
  db.close();
});

test("4. 已有书稿下一校次为三校时可选择读校", () => {
  const db = freshDb();
  const { bookId } = toCompleted(db, { title: "书", stage: "SECOND_PROOF" });
  const newTaskId = publishTask(db, { operatorId: 1, bookId, stage: "THIRD_PROOF", starLevel: 1, workType: "PROOFREAD", companyId: 2 });
  const t = db.prepare("SELECT stage, work_type FROM tasks WHERE id = ?").get(newTaskId) as { stage: string; work_type: string };
  assert.strictEqual(t.stage, "THIRD_PROOF");
  assert.strictEqual(t.work_type, "PROOFREAD");
  db.close();
});

test("5. 已有书稿下一校次为三校时可选择核红，但 stage 仍为三校", () => {
  const db = freshDb();
  const { bookId } = toCompleted(db, { title: "书", stage: "SECOND_PROOF" });
  const newTaskId = publishTask(db, { operatorId: 1, bookId, stage: "THIRD_PROOF", starLevel: 1, workType: "RED_CHECK", companyId: 2 });
  const t = db.prepare("SELECT stage, work_type FROM tasks WHERE id = ?").get(newTaskId) as { stage: string; work_type: string };
  assert.strictEqual(t.stage, "THIRD_PROOF");
  assert.strictEqual(t.work_type, "RED_CHECK");
  db.close();
});

test("6. 已有书稿下一校次为三校时可选择读校且核红，但 stage 仍为三校", () => {
  const db = freshDb();
  const { bookId } = toCompleted(db, { title: "书", stage: "SECOND_PROOF" });
  const newTaskId = publishTask(db, { operatorId: 1, bookId, stage: "THIRD_PROOF", starLevel: 1, workType: "PROOFREAD_AND_RED_CHECK", companyId: 2 });
  const t = db.prepare("SELECT stage, work_type FROM tasks WHERE id = ?").get(newTaskId) as { stage: string; work_type: string };
  assert.strictEqual(t.stage, "THIRD_PROOF");
  assert.strictEqual(t.work_type, "PROOFREAD_AND_RED_CHECK");
  db.close();
});

test("7. 非法 work_type 被服务端拒绝", () => {
  const db = freshDb();
  assertThrowsCode(
    () => publishTask(db, { operatorId: 1, bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 1, workType: "BOGUS", companyId: 2 }),
    "INVALID_INPUT",
  );
  db.close();
});

test("8. 缺少 work_type 的旧调用安全默认为读校", () => {
  const db = freshDb();
  const { bookId } = toCompleted(db, { title: "书", stage: "INITIAL_REVIEW" });
  const newTaskId = publishTask(db, { operatorId: 1, bookId, stage: "FIRST_PROOF", starLevel: 1, companyId: 2 });
  const t = db.prepare("SELECT work_type FROM tasks WHERE id = ?").get(newTaskId) as { work_type: string };
  assert.strictEqual(t.work_type, "PROOFREAD");
  db.close();
});

test("9. 核红不再是终止校次（加校完成后可继续发起加校）", () => {
  const db = freshDb();
  const { bookId } = toCompleted(db, { title: "书", stage: "ADDITIONAL_PROOF" });
  const newTaskId = publishTask(db, { operatorId: 1, bookId, stage: "ADDITIONAL_PROOF", starLevel: 1, companyId: 2 });
  const t = db.prepare("SELECT stage FROM tasks WHERE id = ?").get(newTaskId) as { stage: string };
  assert.strictEqual(t.stage, "ADDITIONAL_PROOF");
  db.close();
});

test("10. nextStage 校次顺序：加校 → 加校", () => {
  assert.strictEqual(nextStage("THIRD_PROOF"), "ADDITIONAL_PROOF");
  assert.strictEqual(nextStage("ADDITIONAL_PROOF"), "ADDITIONAL_PROOF");
});

test("11. 搜索结果显示校次和工作内容", () => {
  const db = freshDb();
  publishTask(db, { operatorId: 1, bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 1, workType: "RED_CHECK", companyId: 2 });
  const r = searchBooks(db, "书", 1, 20);
  assert.strictEqual(r.results.length, 1);
  assert.strictEqual(r.results[0].stage, "INITIAL_REVIEW");
  assert.strictEqual(r.results[0].workType, "RED_CHECK");
  db.close();
});

test("12. 详情页显示校次和工作内容", () => {
  const db = freshDb();
  const taskId = publishTask(db, { operatorId: 1, bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 1, workType: "PROOFREAD_AND_RED_CHECK", companyId: 2 });
  const bookId = bookIdOf(db, taskId);
  const d = getBookDetail(db, bookId);
  assert.ok(d);
  assert.strictEqual(d.tasks[0].stage, "INITIAL_REVIEW");
  assert.strictEqual(d.tasks[0].workType, "PROOFREAD_AND_RED_CHECK");
  db.close();
});

test("13. 工作内容中文名称映射正确", () => {
  assert.strictEqual(WORK_TYPE_LABELS.PROOFREAD, "读校");
  assert.strictEqual(WORK_TYPE_LABELS.RED_CHECK, "核红");
  assert.strictEqual(WORK_TYPE_LABELS.PROOFREAD_AND_RED_CHECK, "读校且核红");
});

test("14. 管理员代发布正确记录工作内容和审计", () => {
  const db = freshDb();
  const { bookId } = toCompleted(db, { title: "书", editorId: 1 });
  const auditsBefore = rows(db, "audit_log");
  const newTaskId = publishTask(db, { operatorId: 4, bookId, stage: "FIRST_PROOF", starLevel: 1, workType: "RED_CHECK", companyId: 2, editorId: 1, proxyReason: "代发核红" });
  const t = db.prepare("SELECT work_type, publisher_id FROM tasks WHERE id = ?").get(newTaskId) as { work_type: string; publisher_id: number };
  assert.strictEqual(t.work_type, "RED_CHECK");
  assert.strictEqual(t.publisher_id, 1);
  assert.strictEqual(rows(db, "audit_log"), auditsBefore + 1);
  const audit = db.prepare("SELECT after_value FROM audit_log WHERE target_id = ? AND operation_type = 'PROXY_PUBLISH'").get(String(newTaskId)) as { after_value: string };
  assert.ok(audit.after_value.includes("RED_CHECK"));
  db.close();
});

test("15. 首页/详情显示组件使用工作内容映射（源码检查）", () => {
  const row = fs.readFileSync(path.join(process.cwd(), "components", "DashboardTaskRow.tsx"), "utf-8");
  assert.ok(row.includes("WORK_TYPE_LABELS"));
  assert.ok(row.includes("workType"));
});

test("16. 数据库迁移脚本幂等且为 work_type 提供默认值（源码检查）", () => {
  const mig = fs.readFileSync(path.join(process.cwd(), "scripts", "db-migrate.mjs"), "utf-8");
  assert.ok(mig.includes("work_type"));
  assert.ok(mig.includes("PROOFREAD"));
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  assert.ok(schema.includes("work_type"));
  assert.ok(schema.includes("DEFAULT 'PROOFREAD'"));
});

test("17. 正式数据库不被测试数据污染", () => {
  if (!fs.existsSync(FORMAL_PATH)) return;
  assert.deepStrictEqual(formalCounts(), FORMAL_BASELINE);
});
