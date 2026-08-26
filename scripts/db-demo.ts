import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword } from "../lib/password.ts";
import {
  publishTask,
  confirmReceipt,
  startTask,
  finishTask,
  cancelTask,
} from "../lib/task-service.ts";

// ===== 演示数据库生成脚本 =====
// 仅在 data/demo/ 内生成独立的虚构演示数据库，绝不触碰正式数据库。
// 演示数据全部虚构；演示密码统一为 123456，禁止用于正式部署。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const FORMAL_DB = path.resolve(
  process.env.DATABASE_PATH || path.join(root, "data", "publishing-process.db"),
);
const DEMO_DIR = path.join(root, "data", "demo");
const DEMO_DB = path.join(DEMO_DIR, "publishing-process-demo.db");

// 安全校验：演示库必须位于 data/demo/ 内，且不得等于正式库路径。
if (path.resolve(DEMO_DB) === FORMAL_DB) {
  console.error("拒绝执行：演示库路径与正式数据库相同");
  process.exit(1);
}
if (path.dirname(path.resolve(DEMO_DB)) !== path.resolve(DEMO_DIR)) {
  console.error("拒绝执行：演示库不在 data/demo/ 目录内");
  process.exit(1);
}

const SCHEMA = fs.readFileSync(path.join(root, "lib", "schema.sql"), "utf-8");

// 重新生成演示库（仅删除 data/demo/ 内的旧演示库及其 WAL/SHM/Journal）。
for (const ext of ["", "-wal", "-shm", "-journal"]) {
  const f = DEMO_DB + ext;
  if (fs.existsSync(f)) fs.rmSync(f, { force: true });
}
fs.mkdirSync(DEMO_DIR, { recursive: true });

const db = new Database(DEMO_DB);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.exec(SCHEMA);

// ===== 虚构演示账户 =====
const C = { internal: 1, companyA: 2, companyB: 3 };
const U = { admin: 1, editorA: 2, editorB: 3, supervisor: 4, pfA: 5, pfB: 6, supervisorB: 7, pfC: 8 };

const demoPassword = hashPassword("123456"); // 演示密码，禁止用于正式部署

db.prepare(
  "INSERT INTO companies(id, name, type) VALUES (1, '社内演示部', 'INTERNAL'), (2, '演示外校公司A', 'EXTERNAL'), (3, '演示外校公司B', 'EXTERNAL')",
).run();
db.prepare(
  `INSERT INTO users(id, username, display_name, role, company_id, is_active, must_change_password, password_hash) VALUES
    (1, 'demo_admin', '演示管理员', 'INTERNAL_ADMIN', 1, 1, 0, ?),
    (2, 'demo_editor_a', '演示编辑甲', 'RESPONSIBLE_EDITOR', 1, 1, 0, ?),
    (3, 'demo_editor_b', '演示编辑乙', 'RESPONSIBLE_EDITOR', 1, 1, 0, ?),
    (4, 'demo_supervisor', '演示主管甲', 'EXTERNAL_SUPERVISOR', 2, 1, 0, ?),
    (5, 'demo_proofreader_a', '演示校对甲', 'PROOFREADER', 2, 1, 0, ?),
    (6, 'demo_proofreader_b', '演示校对乙', 'PROOFREADER', 2, 1, 0, ?),
    (7, 'demo_supervisor_b', '演示主管乙', 'EXTERNAL_SUPERVISOR', 3, 1, 0, ?),
    (8, 'demo_proofreader_c', '演示校对丙', 'PROOFREADER', 3, 1, 0, ?)`,
).run(
  demoPassword,
  demoPassword,
  demoPassword,
  demoPassword,
  demoPassword,
  demoPassword,
  demoPassword,
  demoPassword,
);

// ===== 虚构业务数据（全部使用真实服务函数写入，保证事件与审计一致） =====

function publish(
  editorId: number,
  title: string,
  stage: string,
  starLevel: number,
  workType: string,
  companyId: number,
  workWordCount: number,
): number {
  return publishTask(db, {
    operatorId: editorId,
    bookTitle: title,
    stage,
    starLevel,
    workType,
    companyId,
    workWordCount,
  });
}

function confirm(
  taskId: number,
  companyId: number,
  externalConfirmedWordCount?: number,
): void {
  if (companyId === C.companyA) {
    confirmReceipt(db, taskId, U.supervisor, { externalConfirmedWordCount });
  } else {
    confirmReceipt(db, taskId, U.admin, {
      proxyReason: "演示代确认（外校公司B）",
      externalConfirmedWordCount,
    });
  }
}

function bookIdOf(taskId: number): number {
  return (
    db.prepare("SELECT book_id FROM tasks WHERE id = ?").get(taskId) as { book_id: number }
  ).book_id;
}

function toCompleted(
  editorId: number,
  title: string,
  stage: string,
  starLevel: number,
  workType: string,
  companyId: number,
  proofreaderId: number,
  workWordCount: number,
  externalConfirmedWordCount?: number,
): number {
  const id = publish(editorId, title, stage, starLevel, workType, companyId, workWordCount);
  confirm(id, companyId, externalConfirmedWordCount);
  startTask(db, id, proofreaderId);
  finishTask(db, id, proofreaderId);
  return id;
}

function toReady(
  editorId: number,
  title: string,
  stage: string,
  starLevel: number,
  workType: string,
  companyId: number,
  workWordCount: number,
  externalConfirmedWordCount?: number,
): number {
  const id = publish(editorId, title, stage, starLevel, workType, companyId, workWordCount);
  confirm(id, companyId, externalConfirmedWordCount);
  return id;
}

// ---- 1. 已完成（5 条，含多校次历史链路） ----
// 多校次史：一校 → 二校（同一本书两个先后校次）；一校外校主管将确认字数 120000 调整为 118000。
const multiFirst = toCompleted(U.editorA, "《演示图书·多校次史》", "FIRST_PROOF", 1, "PROOFREAD", C.companyA, U.pfA, 120000, 118000);
const multiBook = bookIdOf(multiFirst);
const multiSecond = publishTask(db, {
  operatorId: U.editorA,
  bookId: multiBook,
  stage: "FIRST_PROOF", // 已有书稿模式：校次由服务端自动计算为二校
  starLevel: 1,
  workType: "PROOFREAD",
  companyId: C.companyA,
  workWordCount: 118000,
});
confirm(multiSecond, C.companyA);
startTask(db, multiSecond, U.pfA);
finishTask(db, multiSecond, U.pfA);

toCompleted(U.editorB, "《演示图书·核红样本》", "FIRST_PROOF", 2, "RED_CHECK", C.companyA, U.pfB, 98000);
toCompleted(U.editorA, "《演示图书·重点评奖》", "SECOND_PROOF", 3, "PROOFREAD_AND_RED_CHECK", C.companyA, U.pfA, 200000, 195000);
toCompleted(U.editorB, "《演示图书·编辑乙稿》", "INITIAL_REVIEW", 1, "PROOFREAD", C.companyA, U.pfB, 66000);

// ---- 2. 待确认收稿（2 条） ----
publish(U.editorA, "《演示图书·待确认一》", "INITIAL_REVIEW", 2, "PROOFREAD", C.companyA, 88000);
publish(U.editorB, "《演示图书·待确认二》", "THIRD_PROOF", 3, "PROOFREAD_AND_RED_CHECK", C.companyA, 135000);

// ---- 3. 书稿仓库 READY_TO_START（4 条，覆盖星/校次/工作内容，含外校公司B） ----
toReady(U.editorA, "《演示图书·仓库一》", "FIRST_PROOF", 1, "PROOFREAD", C.companyA, 72000);
toReady(U.editorB, "《演示图书·仓库二》", "SECOND_PROOF", 2, "RED_CHECK", C.companyA, 88000);
toReady(U.editorA, "《演示图书·仓库三》", "THIRD_PROOF", 3, "PROOFREAD_AND_RED_CHECK", C.companyA, 160000);
toReady(U.editorB, "《演示图书·仓库B》", "ADDITIONAL_PROOF", 1, "PROOFREAD", C.companyB, 54000);

// ---- 4. 生产线 IN_PROGRESS（1 条，分配给演示校对甲） ----
const inProgressId = publish(U.editorB, "《演示图书·进行中》", "FIRST_PROOF", 2, "PROOFREAD", C.companyA, 92000);
confirm(inProgressId, C.companyA);
startTask(db, inProgressId, U.pfA);

// ---- 5. 取消记录（1 条，不物理删除） ----
const cancelledId = publish(U.editorA, "《演示图书·误发待取消》", "INITIAL_REVIEW", 1, "PROOFREAD", C.companyA, 30000);
cancelTask(db, cancelledId, U.editorA, "误发演示");

// ---- 6. 滞留演示（2 条，相对当前时间，严格大于阈值） ----
const overdue1 = publish(U.editorA, "《演示图书·滞留预警初审》", "INITIAL_REVIEW", 1, "PROOFREAD", C.companyA, 210000);
db.prepare("UPDATE tasks SET published_at = ? WHERE id = ?").run(
  new Date(Date.now() - 95 * 86400000).toISOString(), // 初审阈值 90 天，滞留 5 天
  overdue1,
);
const overdue2 = toReady(U.editorB, "《演示图书·滞留预警急稿》", "FIRST_PROOF", 3, "PROOFREAD", C.companyA, 99000);
db.prepare("UPDATE tasks SET published_at = ? WHERE id = ?").run(
  new Date(Date.now() - 10 * 86400000).toISOString(), // 三星阈值 7 天，滞留 3 天
  overdue2,
);

// ---- 7. 报表中心演示数据（跨月/半年/年度、按期/超期/滞留/取消、字数缺失、多公司） ----

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}
function setPublished(taskId: number, daysAgo: number): void {
  db.prepare("UPDATE tasks SET published_at = ? WHERE id = ?").run(daysAgoIso(daysAgo), taskId);
}
function setFinished(taskId: number, daysAgo: number): void {
  db.prepare("UPDATE tasks SET finished_at = ? WHERE id = ?").run(daysAgoIso(daysAgo), taskId);
}
function setCancelled(taskId: number, daysAgo: number): void {
  db.prepare("UPDATE tasks SET cancelled_at = ? WHERE id = ?").run(daysAgoIso(daysAgo), taskId);
}
// 已完成任务：发布/确认/开始/结束后，再把发布与完成时间回拨到指定天数前。
function reportCompleted(
  editorId: number,
  title: string,
  stage: string,
  starLevel: number,
  companyId: number,
  supervisorId: number,
  proofreaderId: number,
  workWordCount: number,
  externalConfirmedWordCount: number,
  publishedDaysAgo: number,
  finishedDaysAgo: number,
): number {
  const id = publishTask(db, {
    operatorId: editorId,
    bookTitle: title,
    stage,
    starLevel,
    workType: "PROOFREAD",
    companyId,
    workWordCount,
  });
  confirmReceipt(db, id, supervisorId, { externalConfirmedWordCount });
  startTask(db, id, proofreaderId);
  finishTask(db, id, proofreaderId);
  setPublished(id, publishedDaysAgo);
  setFinished(id, finishedDaysAgo);
  return id;
}

// 公司A：按期/超期/字数缺失/历史滞留/年报样本
reportCompleted(U.editorA, "《演示图书·报表按期甲》", "FIRST_PROOF", 1, C.companyA, U.supervisor, U.pfB, 120000, 118000, 10, 4);
reportCompleted(U.editorB, "《演示图书·报表按期乙》", "FIRST_PROOF", 1, C.companyA, U.supervisor, U.pfB, 80000, 80000, 40, 36);
const raOverdue = reportCompleted(U.editorA, "《演示图书·报表超期》", "FIRST_PROOF", 1, C.companyA, U.supervisor, U.pfB, 150000, 150000, 70, 30);
db.prepare("UPDATE tasks SET external_confirmed_word_count = NULL WHERE id = ?").run(raOverdue); // 外校确认字数缺失
const raMissingWork = reportCompleted(U.editorB, "《演示图书·报表缺工作字数》", "SECOND_PROOF", 2, C.companyA, U.supervisor, U.pfB, 90000, 90000, 100, 92);
db.prepare("UPDATE tasks SET work_word_count = NULL WHERE id = ?").run(raMissingWork); // 工作字数缺失
reportCompleted(U.editorA, "《演示图书·历史滞留后完成》", "FIRST_PROOF", 1, C.companyA, U.supervisor, U.pfB, 100000, 100000, 80, 5); // 发布 80 天前、完成 5 天前
reportCompleted(U.editorB, "《演示图书·年报样本》", "INITIAL_REVIEW", 1, C.companyA, U.supervisor, U.pfB, 70000, 70000, 200, 195);

// 滞留（仍在仓库，未完成）
const raStuck = toReady(U.editorA, "《演示图书·报表滞留》", "FIRST_PROOF", 1, "PROOFREAD", C.companyA, 110000);
setPublished(raStuck, 95);

// 取消（不计入报表）
const raCancel = publish(U.editorA, "《演示图书·报表取消》", "FIRST_PROOF", 1, "PROOFREAD", C.companyA, 50000);
cancelTask(db, raCancel, U.editorA, "报表演示误发");
setPublished(raCancel, 60);
setCancelled(raCancel, 55);

// 公司B：外校主管乙 + 校对丙，用于验证公司隔离
reportCompleted(U.editorA, "《演示图书·报表公司B甲》", "FIRST_PROOF", 1, C.companyB, U.supervisorB, U.pfC, 60000, 60000, 15, 10);
reportCompleted(U.editorB, "《演示图书·报表公司B乙》", "FIRST_PROOF", 1, C.companyB, U.supervisorB, U.pfC, 50000, 50000, 90, 85);
const rbReady = publishTask(db, {
  operatorId: U.editorA,
  bookTitle: "《演示图书·报表公司B待开始》",
  stage: "FIRST_PROOF",
  starLevel: 1,
  workType: "PROOFREAD",
  companyId: C.companyB,
  workWordCount: 45000,
});
confirmReceipt(db, rbReady, U.supervisorB, {});
setPublished(rbReady, 30);

// ===== 输出摘要 =====
function count(sql: string): number {
  return (db.prepare(sql).get() as { c: number }).c;
}
const statusCounts = db
  .prepare("SELECT status, COUNT(*) c FROM tasks GROUP BY status ORDER BY status")
  .all() as { status: string; c: number }[];

console.log(`演示库：${DEMO_DB}`);
console.log("业务表行数：");
for (const t of ["companies", "users", "books", "tasks", "task_events", "audit_log", "deliveries", "delivery_receipts"]) {
  console.log(`  ${t}: ${count(`SELECT COUNT(*) c FROM ${t}`)}`);
}
console.log("各状态任务数：");
for (const s of statusCounts) console.log(`  ${s.status}: ${s.c}`);
console.log("演示账户（密码统一为 123456，禁止用于正式部署）：");
for (const r of db
  .prepare("SELECT username, role FROM users ORDER BY id")
  .all() as { username: string; role: string }[]) {
  console.log(`  ${r.username} (${r.role})`);
}

db.close();
console.log("演示数据库生成完成。");
