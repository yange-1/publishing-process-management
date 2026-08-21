import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  publishTask,
  listActiveEditors,
  isAdminRole,
  filterEditorsByQuery,
  editorSelectionClearsOn,
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
    "INSERT INTO companies(id, name, type) VALUES (1, '社内', 'INTERNAL'), (2, '外校A', 'EXTERNAL')",
  ).run();
  db.prepare(
    `INSERT INTO users(id, username, display_name, role, company_id) VALUES
      (1, 'editor1', '编辑甲', 'RESPONSIBLE_EDITOR', 1),
      (2, 'editor2', '编辑乙', 'RESPONSIBLE_EDITOR', 1),
      (3, 'sup1', '主管甲', 'EXTERNAL_SUPERVISOR', 2),
      (4, 'pf1', '校对甲', 'PROOFREADER', 2),
      (5, 'admin1', '管理员', 'INTERNAL_ADMIN', 1)`,
  ).run();
  db.prepare(
    "INSERT INTO users(id, username, display_name, role, company_id, is_active) VALUES (6, 'editor3', '停用编辑', 'RESPONSIBLE_EDITOR', 1, 0)",
  ).run();
  return db;
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

test("1. 责任编辑可以为自己发布新书稿", () => {
  const db = freshDb();
  const taskId = publishTask(db, {
    operatorId: 1,
    bookTitle: "测试图书A",
    stage: "INITIAL_REVIEW",
    starLevel: 1,
    companyId: 2,
  });
  assert.ok(taskId > 0);
  const t = db.prepare("SELECT publisher_id FROM tasks WHERE id = ?").get(taskId) as { publisher_id: number };
  assert.strictEqual(t.publisher_id, 1);
  db.close();
});

test("2. 责任编辑不能冒充其他责任编辑", () => {
  const db = freshDb();
  const taskId = publishTask(db, {
    operatorId: 1,
    editorId: 2, // 试图冒充编辑乙，应被忽略
    bookTitle: "测试图书B",
    stage: "INITIAL_REVIEW",
    starLevel: 1,
    companyId: 2,
  });
  const t = db.prepare("SELECT publisher_id FROM tasks WHERE id = ?").get(taskId) as { publisher_id: number };
  assert.strictEqual(t.publisher_id, 1);
  db.close();
});

test("3. 外校主管不能发布", () => {
  const db = freshDb();
  assertThrowsCode(
    () => publishTask(db, { operatorId: 3, bookTitle: "x", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 2 }),
    "FORBIDDEN",
  );
  db.close();
});

test("4. 校对人员不能发布", () => {
  const db = freshDb();
  assertThrowsCode(
    () => publishTask(db, { operatorId: 4, bookTitle: "x", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 2 }),
    "FORBIDDEN",
  );
  db.close();
});

test("5. 超级管理员可以代责任编辑发布", () => {
  const db = freshDb();
  const taskId = publishTask(db, {
    operatorId: 5,
    editorId: 1,
    proxyReason: "编辑请假代发",
    bookTitle: "测试图书C",
    stage: "INITIAL_REVIEW",
    starLevel: 1,
    companyId: 2,
  });
  assert.ok(taskId > 0);
  const t = db.prepare("SELECT publisher_id FROM tasks WHERE id = ?").get(taskId) as { publisher_id: number };
  assert.strictEqual(t.publisher_id, 1); // 目标责任编辑为编辑甲
  db.close();
});

test("6. 管理员代发布缺少原因时失败", () => {
  const db = freshDb();
  assertThrowsCode(
    () => publishTask(db, { operatorId: 5, editorId: 1, bookTitle: "x", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 2 }),
    "PROXY_REASON_REQUIRED",
  );
  db.close();
});

test("7. 停用账号不能发布", () => {
  const db = freshDb();
  assertThrowsCode(
    () => publishTask(db, { operatorId: 6, bookTitle: "x", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 2 }),
    "USER_INACTIVE",
  );
  db.close();
});

test("8. 新书稿正确创建books和tasks", () => {
  const db = freshDb();
  const booksBefore = rows(db, "books");
  const tasksBefore = rows(db, "tasks");
  publishTask(db, { operatorId: 1, bookTitle: "测试图书D", stage: "FIRST_PROOF", starLevel: 2, companyId: 2 });
  assert.strictEqual(rows(db, "books"), booksBefore + 1);
  assert.strictEqual(rows(db, "tasks"), tasksBefore + 1);
  db.close();
});

test("9. 已有书稿继续发起任务时复用book_id", () => {
  const db = freshDb();
  const first = publishTask(db, { operatorId: 1, bookTitle: "测试图书E", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 2 });
  db.prepare("UPDATE tasks SET status = 'COMPLETED' WHERE id = ?").run(first);
  const bookId = (db.prepare("SELECT book_id FROM tasks WHERE id = ?").get(first) as { book_id: number }).book_id;
  const booksBefore = rows(db, "books");
  const second = publishTask(db, { operatorId: 1, bookId, stage: "FIRST_PROOF", starLevel: 1, companyId: 2 });
  const bookId2 = (db.prepare("SELECT book_id FROM tasks WHERE id = ?").get(second) as { book_id: number }).book_id;
  assert.strictEqual(bookId2, bookId);
  assert.strictEqual(rows(db, "books"), booksBefore); // 未新建书稿
  db.close();
});

test("10. 普通责任编辑不能选用别人的书稿", () => {
  const db = freshDb();
  const first = publishTask(db, { operatorId: 1, bookTitle: "编辑甲的书", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 2 });
  const bookId = (db.prepare("SELECT book_id FROM tasks WHERE id = ?").get(first) as { book_id: number }).book_id;
  assertThrowsCode(
    () => publishTask(db, { operatorId: 2, bookId, stage: "FIRST_PROOF", starLevel: 1, companyId: 2 }),
    "FORBIDDEN",
  );
  db.close();
});

test("11. 初始状态为PENDING_CONFIRMATION", () => {
  const db = freshDb();
  const taskId = publishTask(db, { operatorId: 1, bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 2 });
  const t = db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as { status: string };
  assert.strictEqual(t.status, "PENDING_CONFIRMATION");
  db.close();
});

test("12. 发布时间由服务端生成", () => {
  const db = freshDb();
  const taskId = publishTask(db, { operatorId: 1, bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 2 });
  const t = db.prepare("SELECT published_at FROM tasks WHERE id = ?").get(taskId) as { published_at: string };
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(t.published_at));
  db.close();
});

test("13. 成功产生TASK_PUBLISHED事件", () => {
  const db = freshDb();
  const taskId = publishTask(db, { operatorId: 1, bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 2 });
  const c = (db.prepare("SELECT COUNT(*) c FROM task_events WHERE task_id = ? AND event_type = 'TASK_PUBLISHED'").get(taskId) as { c: number }).c;
  assert.strictEqual(c, 1);
  db.close();
});

test("14. 管理员代发布产生审计记录", () => {
  const db = freshDb();
  const before = rows(db, "audit_log");
  publishTask(db, { operatorId: 5, editorId: 1, proxyReason: "代发", bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 2 });
  assert.strictEqual(rows(db, "audit_log"), before + 1);
  db.close();
});

test("15. 管理员代发布审计信息完整", () => {
  const db = freshDb();
  const taskId = publishTask(db, { operatorId: 5, editorId: 1, proxyReason: "编辑请假代发", bookTitle: "书", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 2 });
  const audit = db.prepare(
    "SELECT operator_id, operation_type, target_type, target_id, reason, proxy_role, after_value FROM audit_log WHERE operation_type = 'PROXY_PUBLISH' AND target_id = ?",
  ).get(String(taskId)) as {
    operator_id: number;
    operation_type: string;
    target_type: string;
    target_id: string;
    reason: string;
    proxy_role: string | null;
    after_value: string | null;
  };
  assert.strictEqual(audit.operator_id, 5);
  assert.strictEqual(audit.operation_type, "PROXY_PUBLISH");
  assert.strictEqual(audit.target_type, "task");
  assert.strictEqual(audit.reason, "编辑请假代发");
  assert.strictEqual(audit.proxy_role, "RESPONSIBLE_EDITOR");
  assert.ok(audit.after_value && audit.after_value.includes('"editorId":1'));
  // 事件记录代操作标记
  const ev = db.prepare("SELECT is_proxy, proxy_role, operator_id FROM task_events WHERE task_id = ? AND event_type = 'TASK_PUBLISHED'").get(taskId) as { is_proxy: number; proxy_role: string | null; operator_id: number };
  assert.strictEqual(ev.is_proxy, 1);
  assert.strictEqual(ev.proxy_role, "RESPONSIBLE_EDITOR");
  assert.strictEqual(ev.operator_id, 5);
  db.close();
});

test("16. 非法校次、星级、公司被拒绝", () => {
  const db = freshDb();
  assertThrowsCode(
    () => publishTask(db, { operatorId: 1, bookTitle: "x", stage: "BAD_STAGE", starLevel: 1, companyId: 2 }),
    "INVALID_STAGE_OR_STAR",
  );
  assertThrowsCode(
    () => publishTask(db, { operatorId: 1, bookTitle: "x", stage: "INITIAL_REVIEW", starLevel: 9, companyId: 2 }),
    "INVALID_STAGE_OR_STAR",
  );
  assertThrowsCode(
    () => publishTask(db, { operatorId: 1, bookTitle: "x", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 999 }),
    "INVALID_COMPANY",
  );
  assertThrowsCode(
    () => publishTask(db, { operatorId: 1, bookTitle: "x", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 1 }),
    "INVALID_COMPANY",
  );
  db.close();
});

test("17. 任一步失败时事务完整回滚（不留孤立书稿或半条任务）", () => {
  const db = freshDb();
  const booksBefore = rows(db, "books");
  const tasksBefore = rows(db, "tasks");
  assertThrowsCode(
    () => publishTask(db, { operatorId: 1, bookTitle: "不该留下的书", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 999 }),
    "INVALID_COMPANY",
  );
  assert.strictEqual(rows(db, "books"), booksBefore);
  assert.strictEqual(rows(db, "tasks"), tasksBefore);
  db.close();
});

test("18. 正式数据库未被自动测试污染", () => {
  if (!fs.existsSync(FORMAL_PATH)) return;
  assert.deepStrictEqual(formalCounts(), FORMAL_BASELINE);
});

test("19. INTERNAL_ADMIN 被识别为可代发布（驱动管理员区域显示）", () => {
  assert.strictEqual(isAdminRole("INTERNAL_ADMIN"), true);
  assert.strictEqual(isAdminRole("RESPONSIBLE_EDITOR"), false);
  assert.strictEqual(isAdminRole("EXTERNAL_SUPERVISOR"), false);
  assert.strictEqual(isAdminRole("PROOFREADER"), false);
});

test("20. 启用的责任编辑出现在下拉框，其余角色不出现", () => {
  const db = freshDb();
  const ids = listActiveEditors(db).map((e) => e.id).sort((a, b) => a - b);
  // 编辑甲(1)、编辑乙(2) 是启用责任编辑；停用编辑(6)、管理员(5)、外校主管(3)、校对人员(4) 不应出现
  assert.deepStrictEqual(ids, [1, 2]);
  db.close();
});

test("21. 管理员发布新书稿缺少目标责任编辑时失败", () => {
  const db = freshDb();
  assertThrowsCode(
    () => publishTask(db, { operatorId: 5, proxyReason: "代发", bookTitle: "x", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 2 }),
    "PROXY_REASON_REQUIRED",
  );
  db.close();
});

test("22. 管理员已有书稿模式使用书稿原责任编辑", () => {
  const db = freshDb();
  const first = publishTask(db, { operatorId: 1, bookTitle: "编辑甲的书", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 2 });
  db.prepare("UPDATE tasks SET status = 'COMPLETED' WHERE id = ?").run(first);
  const bookId = (db.prepare("SELECT book_id FROM tasks WHERE id = ?").get(first) as { book_id: number }).book_id;
  const second = publishTask(db, { operatorId: 5, proxyReason: "编辑甲请假代发", bookId, stage: "FIRST_PROOF", starLevel: 1, companyId: 2 });
  const t = db.prepare("SELECT publisher_id FROM tasks WHERE id = ?").get(second) as { publisher_id: number };
  assert.strictEqual(t.publisher_id, 1); // 自动使用书稿原责任编辑（编辑甲）
  db.close();
});

test("23. 管理员不能改变已有书稿的责任编辑", () => {
  const db = freshDb();
  const first = publishTask(db, { operatorId: 1, bookTitle: "编辑甲的书", stage: "INITIAL_REVIEW", starLevel: 1, companyId: 2 });
  db.prepare("UPDATE tasks SET status = 'COMPLETED' WHERE id = ?").run(first);
  const bookId = (db.prepare("SELECT book_id FROM tasks WHERE id = ?").get(first) as { book_id: number }).book_id;
  const second = publishTask(db, { operatorId: 5, proxyReason: "代发", bookId, stage: "FIRST_PROOF", starLevel: 1, companyId: 2, editorId: 2 });
  const t = db.prepare("SELECT publisher_id FROM tasks WHERE id = ?").get(second) as { publisher_id: number };
  assert.strictEqual(t.publisher_id, 1); // 传 editorId=2 被忽略，仍为书稿原责任编辑（编辑甲）
  db.close();
});

test("24. 按姓名部分匹配搜索责任编辑", () => {
  const editors = [
    { id: 1, display_name: "编辑甲", username: "editor1" },
    { id: 2, display_name: "编辑乙", username: "editor2" },
    { id: 3, display_name: "校对甲", username: "pf1" },
  ];
  const r = filterEditorsByQuery(editors, "编辑");
  assert.deepStrictEqual(r.map((e) => e.id), [1, 2]);
});

test("25. 按登录账号部分匹配搜索责任编辑", () => {
  const editors = [
    { id: 1, display_name: "编辑甲", username: "editor1" },
    { id: 2, display_name: "编辑乙", username: "editor2" },
  ];
  const r = filterEditorsByQuery(editors, "tor1");
  assert.deepStrictEqual(r.map((e) => e.id), [1]);
});

test("26. 无匹配结果返回空列表", () => {
  const editors = [{ id: 1, display_name: "编辑甲", username: "editor1" }];
  assert.deepStrictEqual(filterEditorsByQuery(editors, "不存在"), []);
  // 空查询返回全部
  assert.deepStrictEqual(filterEditorsByQuery(editors, "").map((e) => e.id), [1]);
});

test("27. 修改已选中文字会判定需清除选择", () => {
  assert.strictEqual(editorSelectionClearsOn("编辑甲", "编辑"), true);
  assert.strictEqual(editorSelectionClearsOn("编辑甲", "编辑甲"), false);
  assert.strictEqual(editorSelectionClearsOn(null, "编辑甲"), false);
});
