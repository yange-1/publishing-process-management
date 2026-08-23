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
  countPendingConfirmation,
  wordCountText,
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
      (3, 'pf1', '校对甲', 'PROOFREADER', 2, 1, 0),
      (4, 'admin1', '管理员', 'INTERNAL_ADMIN', 1, 1, 0),
      (5, 'pf2', '校对乙', 'PROOFREADER', 2, 1, 0),
      (6, 'editor2', '编辑乙', 'RESPONSIBLE_EDITOR', 1, 1, 0),
      (7, 'sup2', '主管乙', 'EXTERNAL_SUPERVISOR', 3, 1, 0),
      (8, 'pf3', '校对丙', 'PROOFREADER', 3, 1, 0)`,
  ).run();
  return db;
}

function publish(
  db: Database.Database,
  opts: {
    operatorId?: number;
    title?: string;
    companyId?: number;
    workWordCount?: number;
  } = {},
): number {
  return publishTask(db, {
    operatorId: opts.operatorId ?? 1,
    bookTitle: opts.title ?? "书",
    stage: "FIRST_PROOF",
    starLevel: 1,
    companyId: opts.companyId ?? 2,
    workWordCount: opts.workWordCount,
  });
}

function taskRow(db: Database.Database, taskId: number): {
  work_word_count: number | null;
  external_confirmed_word_count: number | null;
} {
  return db
    .prepare("SELECT work_word_count, external_confirmed_word_count FROM tasks WHERE id = ?")
    .get(taskId) as { work_word_count: number | null; external_confirmed_word_count: number | null };
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

// ===== 一、责任编辑「我的待确认」范围 =====

test("1. 责任编辑待确认数量和列表只含本人发布的任务", () => {
  const db = freshDb();
  publish(db, { operatorId: 1, title: "甲待确认", workWordCount: 1000 });
  publish(db, { operatorId: 6, title: "乙待确认", workWordCount: 2000 });
  const mine = listPendingConfirmation(db, { editorId: 1 });
  assert.deepStrictEqual(mine.map((t) => t.title), ["甲待确认"]);
  assert.strictEqual(countPendingConfirmation(db, { editorId: 1 }), 1);
  db.close();
});

test("2. 直接访问待确认页面对责任编辑做服务端过滤", () => {
  const db = freshDb();
  publish(db, { operatorId: 1, title: "甲待确认" });
  publish(db, { operatorId: 6, title: "乙待确认" });
  // 服务端范围：编辑甲永远看不到编辑乙的待确认任务
  const scoped = listPendingConfirmation(db, { editorId: 1 });
  assert.ok(scoped.every((t) => t.editorId === 1));
  // 页面源码必须按角色传 editorId 范围（不能靠 URL 看到他人任务）
  const page = fs.readFileSync(
    path.join(process.cwd(), "app", "tasks", "pending-confirmation", "page.tsx"),
    "utf-8",
  );
  assert.ok(page.includes("editorId: user.id"));
  assert.ok(page.includes("listPendingConfirmation(db, scope)"));
  db.close();
});

test("3. 管理员可查看全部待确认任务", () => {
  const db = freshDb();
  publish(db, { operatorId: 1, title: "甲待确认" });
  publish(db, { operatorId: 6, title: "乙待确认" });
  assert.strictEqual(listPendingConfirmation(db).length, 2);
  assert.strictEqual(countPendingConfirmation(db), 2);
  db.close();
});

// ===== 二、字数字段与校验 =====

test("4. 工作字数必须为正整数", () => {
  const db = freshDb();
  assertThrowsCode(
    () => publish(db, { workWordCount: 0 }),
    "INVALID_INPUT",
  );
  assertThrowsCode(
    () => publish(db, { workWordCount: -5 }),
    "INVALID_INPUT",
  );
  assertThrowsCode(
    () => publish(db, { workWordCount: 3.5 }),
    "INVALID_INPUT",
  );
  db.close();
});

test("5. 创建任务后外校确认字数默认等于工作字数", () => {
  const db = freshDb();
  const id = publish(db, { workWordCount: 8000 });
  const t = taskRow(db, id);
  assert.strictEqual(t.work_word_count, 8000);
  assert.strictEqual(t.external_confirmed_word_count, 8000);
  db.close();
});

test("6. 外校主管可修改本公司任务的确认字数，工作字数不变", () => {
  const db = freshDb();
  const id = publish(db, { workWordCount: 8000, companyId: 2 });
  const r = confirmReceipt(db, id, 2, { externalConfirmedWordCount: 7600 });
  assert.strictEqual(r, "confirmed");
  const t = taskRow(db, id);
  assert.strictEqual(t.work_word_count, 8000); // 工作字数不被覆盖
  assert.strictEqual(t.external_confirmed_word_count, 7600);
  db.close();
});

test("7. 外校主管不能修改其他公司任务的确认字数", () => {
  const db = freshDb();
  const id = publish(db, { workWordCount: 8000, companyId: 2 });
  assertThrowsCode(
    () => confirmReceipt(db, id, 7, { externalConfirmedWordCount: 100 }),
    "FORBIDDEN",
  );
  db.close();
});

test("8. 责任编辑不能修改确认字数", () => {
  const db = freshDb();
  const id = publish(db, { workWordCount: 8000, companyId: 2 });
  assertThrowsCode(
    () => confirmReceipt(db, id, 1, { externalConfirmedWordCount: 100 }),
    "FORBIDDEN",
  );
  db.close();
});

test("9. 校对人员不能修改两个字段", () => {
  const db = freshDb();
  const id = publish(db, { workWordCount: 8000, companyId: 2 });
  // 校对人员不能确认（即不能改外校确认字数）
  assertThrowsCode(
    () => confirmReceipt(db, id, 3, { externalConfirmedWordCount: 100 }),
    "FORBIDDEN",
  );
  // 校对人员不能发布（即不能填工作字数）
  assertThrowsCode(
    () => publish(db, { operatorId: 3, workWordCount: 100 }),
    "FORBIDDEN",
  );
  db.close();
});

test("10. 修改确认字数后写入事件与审计，历史可追踪", () => {
  const db = freshDb();
  const id = publish(db, { workWordCount: 8000, companyId: 2 });
  confirmReceipt(db, id, 2, { externalConfirmedWordCount: 7600 });
  const ev = db
    .prepare("SELECT note FROM task_events WHERE task_id = ? AND event_type = 'RECEIPT_CONFIRMED'")
    .get(id) as { note: string | null };
  assert.ok(ev.note && ev.note.includes("8000") && ev.note.includes("7600"));
  const audit = db
    .prepare(
      "SELECT operator_id, operation_type, before_value, after_value FROM audit_log WHERE operation_type = 'CONFIRM_WORD_COUNT' AND target_id = ?",
    )
    .get(String(id)) as {
    operator_id: number;
    operation_type: string;
    before_value: string | null;
    after_value: string | null;
  };
  assert.strictEqual(audit.operator_id, 2);
  assert.ok(audit.before_value && audit.before_value.includes("8000"));
  assert.ok(audit.after_value && audit.after_value.includes("7600"));
  db.close();
});

test("10b. 确认字数未变化时不写审计记录", () => {
  const db = freshDb();
  const id = publish(db, { workWordCount: 5000, companyId: 2 });
  confirmReceipt(db, id, 2); // 默认等于工作字数，无变化
  const c = db
    .prepare("SELECT COUNT(*) c FROM audit_log WHERE operation_type = 'CONFIRM_WORD_COUNT' AND target_id = ?")
    .get(String(id)) as { c: number };
  assert.strictEqual(c.c, 0);
  db.close();
});

test("10c. 管理员代确认可改确认字数并记录审计", () => {
  const db = freshDb();
  const id = publish(db, { workWordCount: 9000, companyId: 2 });
  confirmReceipt(db, id, 4, { proxyReason: "代确认", externalConfirmedWordCount: 8500 });
  const t = taskRow(db, id);
  assert.strictEqual(t.work_word_count, 9000);
  assert.strictEqual(t.external_confirmed_word_count, 8500);
  const c = db
    .prepare("SELECT COUNT(*) c FROM audit_log WHERE operation_type = 'CONFIRM_WORD_COUNT' AND target_id = ?")
    .get(String(id)) as { c: number };
  assert.strictEqual(c.c, 1);
  db.close();
});

test("11. 历史任务字数 NULL 正常展示为“未填写”", () => {
  const db = freshDb();
  // 不传 workWordCount：模拟历史任务，两个字段均为 NULL
  const id = publish(db);
  const t = taskRow(db, id);
  assert.strictEqual(t.work_word_count, null);
  assert.strictEqual(t.external_confirmed_word_count, null);
  assert.strictEqual(wordCountText(null), "未填写");
  assert.strictEqual(wordCountText(123), "123字");
  db.close();
});

test("12. 原有发布/确认/开始/结束闭环在带字数时继续通过", () => {
  const db = freshDb();
  const id = publish(db, { workWordCount: 12000, companyId: 2 });
  assert.strictEqual(confirmReceipt(db, id, 2), "confirmed");
  startTask(db, id, 3);
  finishTask(db, id, 3);
  const t = db.prepare("SELECT status FROM tasks WHERE id = ?").get(id) as { status: string };
  assert.strictEqual(t.status, "COMPLETED");
  db.close();
});

test("13. 自动测试不污染正式数据库", () => {
  if (!fs.existsSync(FORMAL_PATH)) return;
  assert.deepStrictEqual(formalCounts(), FORMAL_BASELINE);
});
