import Database from "better-sqlite3";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  publishTask,
  confirmReceipt,
  startTask,
  finishTask,
  cancelTask,
  type TaskServiceError,
} from "../lib/task-service.ts";
import {
  listWarehouse,
  listProduction,
  listCompleted,
  listOverdue,
  countActiveBooks,
  overdueThresholdDays,
} from "../lib/dashboard-service.ts";
import { listMyTodos } from "../lib/todo-service.ts";
import { searchBooks, getBookDetail } from "../lib/search-service.ts";
import {
  filterTasks,
  parseTaskFilter,
  listFilterOptions,
} from "../lib/task-filter-service.ts";

// ===== 第9天完整验收脚本（自动） =====
// 在全新虚构验收库上，用项目真实服务函数走完整业务闭环，输出逐项通过/失败报告。
// 绝不触碰正式数据库；验收库路径与正式库相同会直接拒绝。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const FORMAL_DB = path.resolve(
  process.env.DATABASE_PATH || path.join(root, "data", "publishing-process.db"),
);
const ACCEPTANCE_DB = path.resolve(
  process.env.ACCEPTANCE_DB || path.join(root, "data", "acceptance.db"),
);

if (ACCEPTANCE_DB === FORMAL_DB) {
  console.error("拒绝执行：验收库路径与正式数据库相同");
  process.exit(1);
}

const SCHEMA = fs.readFileSync(path.join(root, "lib", "schema.sql"), "utf-8");

// ===== 验收结果收集 =====
interface CheckResult {
  id: number;
  name: string;
  pass: boolean;
  detail?: string;
}
const results: CheckResult[] = [];
let checkSeq = 0;
function check(name: string, fn: () => void): void {
  checkSeq += 1;
  try {
    fn();
    results.push({ id: checkSeq, name, pass: true });
  } catch (e) {
    const detail =
      e instanceof Error ? e.message : String(e);
    results.push({ id: checkSeq, name, pass: false, detail });
  }
}

function errCode(e: unknown): string {
  return (e as TaskServiceError)?.code ?? "";
}

// ===== 1. 全新验收库 + 虚构种子数据 =====
for (const ext of ["", "-wal", "-shm", "-journal"]) {
  const f = ACCEPTANCE_DB + ext;
  if (fs.existsSync(f)) fs.rmSync(f, { force: true });
}
fs.mkdirSync(path.dirname(ACCEPTANCE_DB), { recursive: true });

const db = new Database(ACCEPTANCE_DB);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.exec(SCHEMA);

db.prepare(
  "INSERT INTO companies(id, name, type) VALUES (1, '社内', 'INTERNAL'), (2, '外校A', 'EXTERNAL'), (3, '外校B', 'EXTERNAL')",
).run();
db.prepare(
  `INSERT INTO users(id, username, display_name, role, company_id, is_active, must_change_password) VALUES
    (1, 'editor1', '编辑甲', 'RESPONSIBLE_EDITOR', 1, 1, 0),
    (2, 'editor2', '编辑乙', 'RESPONSIBLE_EDITOR', 1, 1, 0),
    (3, 'sup1', '主管甲', 'EXTERNAL_SUPERVISOR', 2, 1, 0),
    (4, 'sup2', '主管乙', 'EXTERNAL_SUPERVISOR', 3, 1, 0),
    (5, 'pf1', '校对甲', 'PROOFREADER', 2, 1, 0),
    (6, 'pf2', '校对乙', 'PROOFREADER', 2, 1, 0),
    (7, 'pf3', '校对丙', 'PROOFREADER', 3, 1, 0),
    (8, 'admin', '管理员', 'INTERNAL_ADMIN', 1, 1, 0)`,
).run();

const U = {
  editor1: 1,
  editor2: 2,
  sup1: 3,
  sup2: 4,
  pf1: 5,
  pf2: 6,
  pf3: 7,
  admin: 8,
};

// 供后续校验复用（模块级作用域）
let t3 = 0;
let t4 = 0;

function taskStatus(taskId: number): string {
  const r = db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as
    | { status: string }
    | undefined;
  assert.ok(r, `任务 ${taskId} 不存在`);
  return r.status;
}
function eventCount(taskId: number, type: string): number {
  return (
    db
      .prepare(
        "SELECT COUNT(*) c FROM task_events WHERE task_id = ? AND event_type = ?",
      )
      .get(taskId, type) as { c: number }
  ).c;
}
function auditCount(type: string): number {
  return (
    db
      .prepare("SELECT COUNT(*) c FROM audit_log WHERE operation_type = ?")
      .get(type) as { c: number }
  ).c;
}
function agePublished(taskId: number, daysAgo: number): void {
  const past = new Date(Date.now() - daysAgo * 86400000).toISOString();
  db.prepare("UPDATE tasks SET published_at = ? WHERE id = ?").run(past, taskId);
}

console.log(`验收库：${ACCEPTANCE_DB}`);
console.log("");

// ===== 2. 发布新书稿 =====
const tNew = publishTask(db, {
  operatorId: U.editor1,
  bookTitle: "《测试图书A》",
  stage: "INITIAL_REVIEW",
  starLevel: 2,
  workType: "PROOFREAD",
  companyId: 2,
});

check("发布新书稿后状态为 PENDING_CONFIRMATION", () => {
  assert.strictEqual(taskStatus(tNew), "PENDING_CONFIRMATION");
});
check("发布产生 TASK_PUBLISHED 事件", () => {
  assert.strictEqual(eventCount(tNew, "TASK_PUBLISHED"), 1);
});
check("发布后 books 与 tasks 各增加一条", () => {
  const b = db.prepare("SELECT COUNT(*) c FROM books").get() as { c: number };
  const t = db.prepare("SELECT COUNT(*) c FROM tasks").get() as { c: number };
  assert.strictEqual(b.c, 1);
  assert.strictEqual(t.c, 1);
});

check("外校主管不能发布", () => {
  assert.throws(
    () =>
      publishTask(db, {
        operatorId: U.sup1,
        bookTitle: "非法",
        stage: "INITIAL_REVIEW",
        starLevel: 1,
        companyId: 2,
      }),
    (e: unknown) => errCode(e) === "FORBIDDEN",
  );
});
check("校对人员不能发布", () => {
  assert.throws(
    () =>
      publishTask(db, {
        operatorId: U.pf1,
        bookTitle: "非法",
        stage: "INITIAL_REVIEW",
        starLevel: 1,
        companyId: 2,
      }),
    (e: unknown) => errCode(e) === "FORBIDDEN",
  );
});
check("非法校次被拒绝", () => {
  assert.throws(
    () =>
      publishTask(db, {
        operatorId: U.editor1,
        bookTitle: "非法",
        stage: "RED_CHECK",
        starLevel: 1,
        companyId: 2,
      }),
    (e: unknown) => errCode(e) === "INVALID_STAGE_OR_STAR",
  );
});

// ===== 3. 确认收稿 =====
check("外校主管一键确认本公司任务", () => {
  const r = confirmReceipt(db, tNew, U.sup1);
  assert.strictEqual(r, "confirmed");
  assert.strictEqual(taskStatus(tNew), "READY_TO_START");
});
check("确认产生 RECEIPT_CONFIRMED 事件（is_proxy=0）", () => {
  assert.strictEqual(eventCount(tNew, "RECEIPT_CONFIRMED"), 1);
  const e = db
    .prepare("SELECT is_proxy FROM task_events WHERE task_id=? AND event_type='RECEIPT_CONFIRMED'")
    .get(tNew) as { is_proxy: number };
  assert.strictEqual(e.is_proxy, 0);
});
check("重复确认幂等（不重复事件）", () => {
  const r = confirmReceipt(db, tNew, U.sup1);
  assert.strictEqual(r, "already_confirmed");
  assert.strictEqual(eventCount(tNew, "RECEIPT_CONFIRMED"), 1);
});
check("外校主管不能确认他公司任务", () => {
  const tOther = publishTask(db, {
    operatorId: U.editor1,
    bookTitle: "《他公司书》",
    stage: "FIRST_PROOF",
    starLevel: 1,
    companyId: 3,
  });
  assert.throws(() => confirmReceipt(db, tOther, U.sup1), (e: unknown) => errCode(e) === "FORBIDDEN");
});

// ===== 4. 开始校对 =====
check("校对人员一键开始本公司任务", () => {
  startTask(db, tNew, U.pf1);
  assert.strictEqual(taskStatus(tNew), "IN_PROGRESS");
});
check("开始自动写入 proofreader_id 与 started_at", () => {
  const t = db
    .prepare("SELECT proofreader_id, started_at FROM tasks WHERE id=?")
    .get(tNew) as { proofreader_id: number | null; started_at: string | null };
  assert.strictEqual(t.proofreader_id, U.pf1);
  assert.ok(t.started_at);
});
check("开始产生 TASK_STARTED 事件", () => {
  assert.strictEqual(eventCount(tNew, "TASK_STARTED"), 1);
});
check("一人一书：已有进行中任务时不能开始第二本", () => {
  const t2 = publishTask(db, {
    operatorId: U.editor1,
    bookTitle: "《测试图书B》",
    stage: "FIRST_PROOF",
    starLevel: 1,
    companyId: 2,
  });
  confirmReceipt(db, t2, U.sup1);
  assert.throws(() => startTask(db, t2, U.pf1), (e: unknown) => errCode(e) === "PROOFREADER_BUSY");
});
check("两人抢同一待开始任务只有一人成功", () => {
  t3 = publishTask(db, {
    operatorId: U.editor1,
    bookTitle: "《并发书》",
    stage: "FIRST_PROOF",
    starLevel: 1,
    companyId: 2,
  });
  confirmReceipt(db, t3, U.sup1);
  startTask(db, t3, U.pf2); // 校对乙先成功
  assert.throws(() => startTask(db, t3, U.pf1), (e: unknown) =>
    ["TASK_ALREADY_STARTED", "PROOFREADER_BUSY"].includes(errCode(e)),
  );
});

// ===== 5. 结束校对 =====
check("当前校对人员结束自己的任务", () => {
  finishTask(db, tNew, U.pf1);
  assert.strictEqual(taskStatus(tNew), "COMPLETED");
});
check("结束产生 TASK_COMPLETED 事件", () => {
  assert.strictEqual(eventCount(tNew, "TASK_COMPLETED"), 1);
});
check("结束后保留原 proofreader_id 与 started_at", () => {
  const t = db
    .prepare("SELECT proofreader_id, started_at, finished_at FROM tasks WHERE id=?")
    .get(tNew) as { proofreader_id: number | null; started_at: string | null; finished_at: string | null };
  assert.strictEqual(t.proofreader_id, U.pf1);
  assert.ok(t.started_at);
  assert.ok(t.finished_at);
});
check("非当前校对人员不能结束", () => {
  t4 = publishTask(db, {
    operatorId: U.editor2,
    bookTitle: "《他人任务》",
    stage: "FIRST_PROOF",
    starLevel: 1,
    companyId: 2,
  });
  confirmReceipt(db, t4, U.sup1);
  startTask(db, t4, U.pf1); // 校对甲（此时已空闲）
  assert.throws(() => finishTask(db, t4, U.pf2), (e: unknown) => errCode(e) === "NOT_TASK_PROOFREADER");
});

// ===== 6. 已有书稿继续下一校次 =====
check("已完成书稿可继续发起下一校次，校次自动递增", () => {
  // tNew 已完成（初审），下一校次应为一校
  const bookId = (
    db.prepare("SELECT book_id FROM tasks WHERE id=?").get(tNew) as { book_id: number }
  ).book_id;
  const nextId = publishTask(db, {
    operatorId: U.editor1,
    bookId,
    stage: "RED_CHECK", // 会被忽略，服务端自动计算下一校次
    starLevel: 2,
    companyId: 2,
  });
  const st = db.prepare("SELECT stage FROM tasks WHERE id=?").get(nextId) as { stage: string };
  assert.strictEqual(st.stage, "FIRST_PROOF");
});
check("有未完成任务的书稿不能再次发布", () => {
  // t4 进行中（校对乙），其书稿不应可继续
  const bookId = (
    db.prepare("SELECT book_id FROM tasks WHERE id=?").get(t4) as { book_id: number }
  ).book_id;
  assert.throws(
    () =>
      publishTask(db, {
        operatorId: U.editor2,
        bookId,
        stage: "RED_CHECK", // 会被忽略，服务端自动计算下一校次
        starLevel: 1,
        companyId: 2,
      }),
    (e: unknown) => errCode(e) === "BOOK_HAS_ACTIVE_TASK",
  );
});

// ===== 7. 校次与工作内容分离 =====
check("工作内容独立存储（读校且核红）", () => {
  const id = publishTask(db, {
    operatorId: U.editor2,
    bookTitle: "《工作内容书》",
    stage: "THIRD_PROOF",
    starLevel: 1,
    workType: "PROOFREAD_AND_RED_CHECK",
    companyId: 2,
  });
  const t = db.prepare("SELECT stage, work_type FROM tasks WHERE id=?").get(id) as {
    stage: string;
    work_type: string;
  };
  assert.strictEqual(t.stage, "THIRD_PROOF");
  assert.strictEqual(t.work_type, "PROOFREAD_AND_RED_CHECK");
});

// ===== 8. 代操作（管理员）与审计 =====
const tProxy = publishTask(db, {
  operatorId: U.admin,
  bookTitle: "《代发布书》",
  stage: "INITIAL_REVIEW",
  starLevel: 1,
  companyId: 2,
  editorId: U.editor2,
  proxyReason: "代发布验收",
});
check("管理员代发布正确记录目标责任编辑与审计", () => {
  const t = db
    .prepare("SELECT publisher_id FROM tasks WHERE id=?")
    .get(tProxy) as { publisher_id: number };
  assert.strictEqual(t.publisher_id, U.editor2);
  assert.strictEqual(auditCount("PROXY_PUBLISH"), 1);
});
check("管理员代确认写代理事件与审计", () => {
  confirmReceipt(db, tProxy, U.admin, { proxyReason: "代确认验收" });
  const e = db
    .prepare("SELECT is_proxy, proxy_role FROM task_events WHERE task_id=? AND event_type='RECEIPT_CONFIRMED'")
    .get(tProxy) as { is_proxy: number; proxy_role: string };
  assert.strictEqual(e.is_proxy, 1);
  assert.strictEqual(e.proxy_role, "EXTERNAL_SUPERVISOR");
  assert.strictEqual(auditCount("PROXY_CONFIRM"), 1);
});
check("管理员代开始/代结束写审计", () => {
  finishTask(db, t3, U.pf2); // 校对乙先结束并发书，释放一人一书占用
  startTask(db, tProxy, U.admin, { proofreaderId: U.pf2, proxyReason: "代开始验收" });
  finishTask(db, tProxy, U.admin, { proxyReason: "代结束验收" });
  assert.strictEqual(auditCount("PROXY_START"), 1);
  assert.strictEqual(auditCount("PROXY_FINISH"), 1);
});

// ===== 9. 取消 =====
check("责任编辑取消自己的待开始任务", () => {
  const id = publishTask(db, {
    operatorId: U.editor1,
    bookTitle: "《取消书》",
    stage: "FIRST_PROOF",
    starLevel: 1,
    companyId: 2,
  });
  confirmReceipt(db, id, U.sup1);
  cancelTask(db, id, U.editor1, "误发");
  assert.strictEqual(taskStatus(id), "CANCELLED");
  assert.strictEqual(eventCount(id, "TASK_CANCELLED"), 1);
});
check("责任编辑不能取消他人书稿", () => {
  const id = publishTask(db, {
    operatorId: U.editor2,
    bookTitle: "《他人取消书》",
    stage: "FIRST_PROOF",
    starLevel: 1,
    companyId: 2,
  });
  assert.throws(() => cancelTask(db, id, U.editor1, "越权"), (e: unknown) => errCode(e) === "FORBIDDEN");
});
check("管理员代取消写审计", () => {
  const id = publishTask(db, {
    operatorId: U.editor1,
    bookTitle: "《代取消书》",
    stage: "FIRST_PROOF",
    starLevel: 1,
    companyId: 2,
  });
  cancelTask(db, id, U.admin, "管理员纠错");
  assert.strictEqual(taskStatus(id), "CANCELLED");
  assert.strictEqual(auditCount("PROXY_CANCEL"), 1);
});
check("进行中任务不能取消", () => {
  assert.throws(() => cancelTask(db, t4, U.editor2, "不能取消进行中"), (e: unknown) =>
    errCode(e) === "INVALID_STATUS",
  );
});
check("取消原因必填", () => {
  const id = publishTask(db, {
    operatorId: U.editor1,
    bookTitle: "《空原因书》",
    stage: "FIRST_PROOF",
    starLevel: 1,
    companyId: 2,
  });
  assert.throws(() => cancelTask(db, id, U.editor1, "   "), (e: unknown) =>
    ["PROXY_REASON_REQUIRED", "INVALID_INPUT"].includes(errCode(e)),
  );
});

// ===== 10. 看板统计与排序 =====
check("仓库/生产线/已完成按状态归类", () => {
  // t4 进行中（校对乙），若干已完成，若干取消/待开始
  assert.ok(listProduction(db).some((t) => t.id === t4));
  assert.ok(listCompleted(db).some((t) => t.id === tNew));
  assert.ok(!listWarehouse(db).some((t) => t.status === "IN_PROGRESS"));
});
check("部门现有书稿数量正确", () => {
  const c = countActiveBooks(db);
  const expect = (
    db
      .prepare("SELECT COUNT(DISTINCT book_id) c FROM tasks WHERE status IN ('PENDING_CONFIRMATION','READY_TO_START','IN_PROGRESS')")
      .get() as { c: number }
  ).c;
  assert.strictEqual(c, expect);
});
check("仓库按星级降序排序", () => {
  const w = listWarehouse(db);
  for (let i = 1; i < w.length; i++) {
    assert.ok(w[i - 1].starLevel >= w[i].starLevel);
  }
});

// ===== 11. 滞留规则 =====
check("初审阈值 90 天", () => {
  assert.strictEqual(overdueThresholdDays("INITIAL_REVIEW", 1), 90);
});
check("非初审一星 30 / 二星 15 / 三星 7 天", () => {
  assert.strictEqual(overdueThresholdDays("FIRST_PROOF", 1), 30);
  assert.strictEqual(overdueThresholdDays("FIRST_PROOF", 2), 15);
  assert.strictEqual(overdueThresholdDays("FIRST_PROOF", 3), 7);
});
check("等于阈值不滞留、超过阈值才滞留", () => {
  const id = publishTask(db, {
    operatorId: U.editor1,
    bookTitle: "《边界滞留书》",
    stage: "FIRST_PROOF",
    starLevel: 1,
    companyId: 2,
  });
  agePublished(id, 30); // 等于 30 天
  assert.ok(!listOverdue(db).some((t) => t.id === id));
  agePublished(id, 31); // 超过 30 天
  assert.ok(listOverdue(db).some((t) => t.id === id));
});
check("待确认滞留进预警但不在仓库；待开始滞留仍在仓库", () => {
  const readyId = publishTask(db, {
    operatorId: U.editor1,
    bookTitle: "《滞留待开始书》",
    stage: "FIRST_PROOF",
    starLevel: 1,
    companyId: 2,
  });
  confirmReceipt(db, readyId, U.sup1);
  agePublished(readyId, 40);
  assert.ok(listOverdue(db).some((t) => t.id === readyId));
  assert.ok(listWarehouse(db).some((t) => t.id === readyId));

  const pendingId = publishTask(db, {
    operatorId: U.editor1,
    bookTitle: "《滞留待确认书》",
    stage: "FIRST_PROOF",
    starLevel: 1,
    companyId: 2,
  });
  agePublished(pendingId, 40);
  assert.ok(listOverdue(db).some((t) => t.id === pendingId));
  assert.ok(!listWarehouse(db).some((t) => t.id === pendingId));
});
check("预警最多显示 20 条（列表返回全部）", () => {
  for (let i = 0; i < 25; i++) {
    const id = publishTask(db, {
      operatorId: U.editor1,
      bookTitle: `《批量滞留${i}》`,
      stage: "FIRST_PROOF",
      starLevel: 1,
      companyId: 2,
    });
    agePublished(id, 40);
  }
  const all = listOverdue(db);
  assert.ok(all.length >= 25);
  assert.strictEqual(all.slice(0, 20).length, 20);
});

// ===== 12. 我的待办范围 =====
check("责任编辑待办只含自己书稿", () => {
  const s = listMyTodos(db, { id: U.editor1, role: "RESPONSIBLE_EDITOR", companyId: 1 });
  assert.ok(s.items.every((i) => i.editorId === U.editor1));
});
check("外校主管待办只含本公司待确认任务", () => {
  const s = listMyTodos(db, { id: U.sup1, role: "EXTERNAL_SUPERVISOR", companyId: 2 });
  assert.ok(s.items.every((i) => i.companyId === 2 && i.status === "PENDING_CONFIRMATION"));
});
check("校对人员待办只含本公司待开始或本人任务", () => {
  const s = listMyTodos(db, { id: U.pf1, role: "PROOFREADER", companyId: 2 });
  assert.ok(
    s.items.every(
      (i) =>
        (i.companyId === 2 && i.status === "READY_TO_START") ||
        (i.proofreaderId === U.pf1 && (i.status === "IN_PROGRESS" || i.status === "COMPLETED")),
    ),
  );
});
check("管理员待办包含全部未取消任务", () => {
  const s = listMyTodos(db, { id: U.admin, role: "INTERNAL_ADMIN", companyId: 1 });
  assert.ok(s.items.every((i) => i.status !== "CANCELLED"));
});

// ===== 13. 搜索与历史 =====
check("按书名搜索", () => {
  const r = searchBooks(db, "测试图书A", 1, 20);
  assert.ok(r.results.some((x) => x.title === "《测试图书A》"));
});
check("按责任编辑姓名搜索", () => {
  const r = searchBooks(db, "编辑甲", 1, 20);
  assert.ok(r.total >= 1);
});
check("书稿详情含时间线事件", () => {
  const bookId = (
    db.prepare("SELECT book_id FROM tasks WHERE id=?").get(tNew) as { book_id: number }
  ).book_id;
  const d = getBookDetail(db, bookId);
  assert.ok(d);
  assert.ok(d.events.length >= 4); // 发布/确认/开始/结束
});

// ===== 14. 筛选 =====
check("按责任编辑筛选", () => {
  const r = filterTasks(db, { editorId: U.editor1, proofreaderId: null, stage: null, status: null });
  assert.ok(r.length > 0 && r.every((t) => t.editorId === U.editor1));
});
check("按校对负责人筛选", () => {
  const r = filterTasks(db, { editorId: null, proofreaderId: U.pf1, stage: null, status: null });
  assert.ok(r.every((t) => t.proofreaderId === U.pf1));
});
check("按校次+状态组合筛选", () => {
  const r = filterTasks(db, {
    editorId: null,
    proofreaderId: null,
    stage: "FIRST_PROOF",
    status: "COMPLETED",
  });
  assert.ok(r.every((t) => t.stage === "FIRST_PROOF" && t.status === "COMPLETED"));
});
check("非法筛选值被忽略", () => {
  const f = parseTaskFilter({ editor: "abc", stage: "RED_CHECK", status: "NOPE" });
  assert.deepStrictEqual(f, { editorId: null, proofreaderId: null, stage: null, status: null });
});
check("下拉选项来自真实用户与全集", () => {
  const o = listFilterOptions(db);
  assert.deepStrictEqual(o.editors.map((e) => e.id).sort(), [1, 2]);
  assert.deepStrictEqual(o.proofreaders.map((p) => p.id).sort(), [5, 6, 7]);
});

// ===== 15. 事件与审计只追加 =====
check("task_events 禁止 UPDATE/DELETE", () => {
  assert.throws(() => db.prepare("UPDATE task_events SET note='x' WHERE id=1").run());
  assert.throws(() => db.prepare("DELETE FROM task_events WHERE id=1").run());
});
check("audit_log 禁止 UPDATE/DELETE", () => {
  assert.throws(() => db.prepare("UPDATE audit_log SET reason='x' WHERE id=1").run());
  assert.throws(() => db.prepare("DELETE FROM audit_log WHERE id=1").run());
});

// ===== 16. 输出报告 =====
const passCount = results.filter((r) => r.pass).length;
const failCount = results.length - passCount;
console.log("======== 验收结果 ========");
for (const r of results) {
  console.log(`${r.pass ? "✅" : "❌"} ${r.id}. ${r.name}${r.pass ? "" : `  → ${r.detail}`}`);
}
console.log("=========================");
console.log(`通过 ${passCount} / ${results.length}，失败 ${failCount}`);

// 验收库保留（不清理），便于后续人工复核；正式库不受影响。
db.close();

if (failCount > 0) process.exit(1);
