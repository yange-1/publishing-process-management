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
import { deliverTask, confirmDeliveryReceipt } from "../lib/delivery-service.ts";

// ===== 演示数据库生成脚本 =====
// 仅在 data/demo/ 内生成独立的虚构演示数据库，绝不触碰正式数据库。
// 演示数据全部虚构；演示密码统一为 123456，禁止用于正式部署。
// 先写入临时库，成功后原子替换目标文件，中途失败不破坏原库。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const FORMAL_DB = path.resolve(
  process.env.DATABASE_PATH || path.join(root, "data", "publishing-process.db"),
);
const DEMO_DIR = path.join(root, "data", "demo");
const DEMO_DB = path.join(DEMO_DIR, "publishing-process-demo.db");
const TMP_DB = path.join(DEMO_DIR, ".publishing-process-demo.tmp.db");

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

fs.mkdirSync(DEMO_DIR, { recursive: true });
// 清理临时库及其 WAL/SHM/Journal。
for (const ext of ["", "-wal", "-shm", "-journal"]) {
  const f = TMP_DB + ext;
  if (fs.existsSync(f)) fs.rmSync(f, { force: true });
}

const db = new Database(TMP_DB);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.exec(SCHEMA);

// ===== 虚构演示账户 =====
const C = { internal: 1, companyA: 2, companyB: 3 };

const demoPassword = hashPassword("123456"); // 演示密码，禁止用于正式部署

db.prepare(
  "INSERT INTO companies(id, name, type) VALUES (1, '社内演示部', 'INTERNAL'), (2, '演示外校公司A', 'EXTERNAL'), (3, '演示外校公司B', 'EXTERNAL')",
).run();

// 账号：1 管理员、10 责任编辑、2 外校主管、10 校对人员。
const U = {
  admin: 1,
  editors: [] as number[], // 2..11
  supervisor: 12, // 公司A
  supervisorB: 13, // 公司B
  proofreaders: [] as number[], // 14..23（A: 14..19，B: 20..23）
};

const users: { id: number; username: string; display: string; role: string; company: number }[] = [
  { id: 1, username: "demo_admin", display: "演示管理员", role: "INTERNAL_ADMIN", company: C.internal },
];
for (let i = 0; i < 10; i++) {
  users.push({
    id: 2 + i,
    username: `demo_editor_${"abcdefghij"[i]}`,
    display: `演示编辑${"甲乙丙丁戊己庚辛壬癸"[i]}`,
    role: "RESPONSIBLE_EDITOR",
    company: C.internal,
  });
}
users.push(
  { id: 12, username: "demo_supervisor", display: "演示主管甲", role: "EXTERNAL_SUPERVISOR", company: C.companyA },
  { id: 13, username: "demo_supervisor_b", display: "演示主管乙", role: "EXTERNAL_SUPERVISOR", company: C.companyB },
);
for (let i = 0; i < 10; i++) {
  const company = i < 6 ? C.companyA : C.companyB;
  users.push({
    id: 14 + i,
    username: `demo_proofreader_${"abcdefghij"[i]}`,
    display: `演示校对${"甲乙丙丁戊己庚辛壬癸"[i]}`,
    role: "PROOFREADER",
    company,
  });
}

for (const u of users) {
  db.prepare(
    "INSERT INTO users(id, username, display_name, role, company_id, is_active, must_change_password, password_hash) VALUES (?,?,?,?,?,1,0,?)",
  ).run(u.id, u.username, u.display, u.role, u.company, demoPassword);
}

U.editors = users.filter((u) => u.role === "RESPONSIBLE_EDITOR").map((u) => u.id);
U.proofreaders = users.filter((u) => u.role === "PROOFREADER").map((u) => u.id);

// ===== 帮助函数 =====
function daysAgoIso(days: number, hourOffset = 0): string {
  return new Date(Date.now() - days * 86400000 + hourOffset * 3600000).toISOString();
}
function setPublished(taskId: number, daysAgo: number): void {
  db.prepare("UPDATE tasks SET published_at = ? WHERE id = ?").run(daysAgoIso(daysAgo), taskId);
}
function setFinished(taskId: number, daysAgo: number): void {
  db.prepare("UPDATE tasks SET finished_at = ? WHERE id = ?").run(daysAgoIso(daysAgo), taskId);
}
function setConfirmedAt(taskId: number, daysAgo: number): void {
  db.prepare("UPDATE tasks SET confirmed_at = ? WHERE id = ?").run(daysAgoIso(daysAgo), taskId);
}
function setStartedAt(taskId: number, daysAgo: number): void {
  db.prepare("UPDATE tasks SET started_at = ? WHERE id = ?").run(daysAgoIso(daysAgo), taskId);
}
function insertDelivery(taskId: number, deliveredById: number, daysAgo: number): number {
  // deliveries 为只追加表（schema 禁止 UPDATE），故直接按回拨时间 INSERT，而非先插入再改时间。
  const at = daysAgoIso(daysAgo);
  const info = db.prepare(
    "INSERT INTO deliveries(task_id, delivered_by, is_proxy, proxy_role, proxy_reason, delivered_at, occurred_at) VALUES (?,?,0,NULL,NULL,?,?)",
  ).run(taskId, deliveredById, at, at);
  return Number(info.lastInsertRowid);
}
function insertReceipt(deliveryId: number, confirmedById: number, daysAgo: number): void {
  const at = daysAgoIso(daysAgo);
  db.prepare(
    "INSERT INTO delivery_receipts(delivery_id, confirmed_by, confirmed_at, occurred_at) VALUES (?,?,?,?)",
  ).run(deliveryId, confirmedById, at, at);
}
function bookIdOf(taskId: number): number {
  return (db.prepare("SELECT book_id FROM tasks WHERE id = ?").get(taskId) as { book_id: number }).book_id;
}

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

function confirm(taskId: number, companyId: number, externalConfirmedWordCount?: number): void {
  if (companyId === C.companyA) {
    confirmReceipt(db, taskId, U.supervisor, { externalConfirmedWordCount });
  } else {
    confirmReceipt(db, taskId, U.supervisorB, { externalConfirmedWordCount });
  }
}

function toReady(
  editorId: number,
  title: string,
  stage: string,
  starLevel: number,
  workType: string,
  companyId: number,
  workWordCount: number,
): number {
  const id = publish(editorId, title, stage, starLevel, workType, companyId, workWordCount);
  confirm(id, companyId);
  return id;
}

function toInProgress(
  editorId: number,
  title: string,
  stage: string,
  starLevel: number,
  workType: string,
  companyId: number,
  proofreaderId: number,
  workWordCount: number,
): number {
  const id = toReady(editorId, title, stage, starLevel, workType, companyId, workWordCount);
  startTask(db, id, proofreaderId);
  return id;
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
): number {
  const id = toInProgress(editorId, title, stage, starLevel, workType, companyId, proofreaderId, workWordCount);
  finishTask(db, id, proofreaderId);
  return id;
}

// 已完成 + 送达 + 确认收货（历史闭环）
function toConfirmed(
  editorId: number,
  title: string,
  stage: string,
  starLevel: number,
  workType: string,
  companyId: number,
  proofreaderId: number,
  workWordCount: number,
): number {
  const id = toCompleted(editorId, title, stage, starLevel, workType, companyId, proofreaderId, workWordCount);
  deliverTask(db, id, companyId === C.companyA ? U.supervisor : U.supervisorB);
  confirmDeliveryReceipt(db, id, editorId);
  return id;
}

// ===== 1. 待确认收稿 PENDING_CONFIRMATION（4 条，覆盖星级与校次）=====
publish(U.editors[0], "【演示】待确认·初审急稿", "INITIAL_REVIEW", 2, "PROOFREAD", C.companyA, 88000);
publish(U.editors[1], "【演示】待确认·一校重要", "FIRST_PROOF", 3, "PROOFREAD_AND_RED_CHECK", C.companyA, 135000);
publish(U.editors[2], "【演示】待确认·二校一般", "SECOND_PROOF", 1, "PROOFREAD", C.companyA, 66000);
publish(U.editors[3], "【演示】待确认·三校核红", "THIRD_PROOF", 2, "RED_CHECK", C.companyB, 92000);

// ===== 2. 书稿仓库 READY_TO_START（6 条）=====
toReady(U.editors[0], "【演示】仓库·一校一般", "FIRST_PROOF", 1, "PROOFREAD", C.companyA, 72000);
toReady(U.editors[1], "【演示】仓库·二校核红", "SECOND_PROOF", 2, "RED_CHECK", C.companyA, 88000);
toReady(U.editors[2], "【演示】仓库·三校读核", "THIRD_PROOF", 3, "PROOFREAD_AND_RED_CHECK", C.companyA, 160000);
toReady(U.editors[3], "【演示】仓库·初审一般", "INITIAL_REVIEW", 1, "PROOFREAD", C.companyA, 54000);
toReady(U.editors[4], "【演示】仓库·加校一般", "ADDITIONAL_PROOF", 1, "PROOFREAD", C.companyB, 61000);
toReady(U.editors[5], "【演示】仓库·一校急稿", "FIRST_PROOF", 2, "PROOFREAD", C.companyB, 77000);

// ===== 4. 运送中（COMPLETED 无 delivery，4 条）=====
toCompleted(U.editors[0], "【演示】运送中·一校", "FIRST_PROOF", 1, "PROOFREAD", C.companyA, U.proofreaders[3], 70000);
toCompleted(U.editors[1], "【演示】运送中·二校", "SECOND_PROOF", 2, "PROOFREAD", C.companyA, U.proofreaders[4], 85000);
toCompleted(U.editors[2], "【演示】运送中·三校", "THIRD_PROOF", 3, "RED_CHECK", C.companyA, U.proofreaders[5], 140000);
toCompleted(U.editors[4], "【演示】运送中·B公司", "FIRST_PROOF", 1, "PROOFREAD", C.companyB, U.proofreaders[7], 62000);

// ===== 5. 已送达未确认（按送达时间边界：今天/1/3/6 天前显示，8 天前超期隐藏）=====
function toDelivered(daysAgo: number, editorId: number, title: string, stage: string, starLevel: number): number {
  const id = toCompleted(editorId, title, stage, starLevel, "PROOFREAD", C.companyA, U.proofreaders[0], 80000);
  insertDelivery(id, U.supervisor, daysAgo);
  return id;
}
toDelivered(0, U.editors[0], "【演示】已送达·今天", "FIRST_PROOF", 1);
toDelivered(1, U.editors[1], "【演示】已送达·昨天", "SECOND_PROOF", 2);
toDelivered(3, U.editors[2], "【演示】已送达·三天前", "THIRD_PROOF", 3);
toDelivered(6, U.editors[3], "【演示】已送达·六天前", "FIRST_PROOF", 1);
toDelivered(8, U.editors[4], "【演示】已送达·八天前（超期）", "FIRST_PROOF", 1);

// ===== 6. 已完成历史（含完整流程 + 送达 + 确认收货）=====
toConfirmed(U.editors[0], "【演示】完成·历史一", "FIRST_PROOF", 1, "PROOFREAD", C.companyA, U.proofreaders[3], 70000);
toConfirmed(U.editors[1], "【演示】完成·历史二", "SECOND_PROOF", 2, "RED_CHECK", C.companyA, U.proofreaders[0], 90000);
toConfirmed(U.editors[2], "【演示】完成·历史三", "THIRD_PROOF", 3, "PROOFREAD_AND_RED_CHECK", C.companyA, U.proofreaders[1], 130000);

// 多校次史：一校 → 二校（同一本书两个先后校次）
const multiFirst = toConfirmed(U.editors[0], "【演示】完成·多校次", "FIRST_PROOF", 1, "PROOFREAD", C.companyA, U.proofreaders[2], 120000);
const multiBook = bookIdOf(multiFirst);
const multiSecond = publishTask(db, {
  operatorId: U.editors[0],
  bookId: multiBook,
  stage: "FIRST_PROOF",
  starLevel: 1,
  workType: "PROOFREAD",
  companyId: C.companyA,
  workWordCount: 118000,
});
confirm(multiSecond, C.companyA);
startTask(db, multiSecond, U.proofreaders[2]);
finishTask(db, multiSecond, U.proofreaders[2]);

// ===== 7. 已取消（3 条：编辑取消 + Dominance 代取消）=====
const cancel1 = publish(U.editors[0], "【演示】取消·编辑误发", "INITIAL_REVIEW", 1, "PROOFREAD", C.companyA, 30000);
cancelTask(db, cancel1, U.editors[0], "误发演示");
const cancel2 = publish(U.editors[1], "【演示】取消·编辑误发2", "FIRST_PROOF", 1, "PROOFREAD", C.companyA, 40000);
cancelTask(db, cancel2, U.editors[1], "误发演示");
const cancel3 = publish(U.editors[2], "【演示】取消·代取消", "INITIAL_REVIEW", 2, "PROOFREAD", C.companyB, 50000);
cancelTask(db, cancel3, U.admin, "Dominance 代取消演示");

// ===== 8. 滞留预警边界（每类：未达 / 达到当天 / 超过）=====
// 阈值：初审 90 天、非初审一般 30 天、急稿 15 天、重要急稿 7 天。
// 未达阈值
publish(U.editors[0], "【演示】滞留·初审未达", "INITIAL_REVIEW", 1, "PROOFREAD", C.companyA, 200000);
// 达到当天 / 超过（用直接 SQL 回拨 published_at）
const o1 = publish(U.editors[1], "【演示】滞留·初审达到", "INITIAL_REVIEW", 1, "PROOFREAD", C.companyA, 210000);
setPublished(o1, 90);
const o2 = publish(U.editors[2], "【演示】滞留·初审超过", "INITIAL_REVIEW", 1, "PROOFREAD", C.companyA, 220000);
setPublished(o2, 95);
const o3 = toReady(U.editors[3], "【演示】滞留·急稿超过", "FIRST_PROOF", 2, "PROOFREAD", C.companyA, 99000);
setPublished(o3, 18);
const o4 = toReady(U.editors[4], "【演示】滞留·重要超过", "FIRST_PROOF", 3, "PROOFREAD", C.companyA, 110000);
setPublished(o4, 10);
const o5 = publish(U.editors[5], "【演示】滞留·一般达到", "FIRST_PROOF", 1, "PROOFREAD", C.companyA, 76000);
setPublished(o5, 30);
const o6 = publish(U.editors[6], "【演示】滞留·一般超过", "FIRST_PROOF", 1, "PROOFREAD", C.companyA, 81000);
setPublished(o6, 34);

// ===== 9. 报表历史数据（2025 + 2026，动态查询，用底层任务）=====
function reportCompleted(
  editorId: number,
  title: string,
  stage: string,
  starLevel: number,
  companyId: number,
  supervisorId: number,
  proofreaderId: number,
  workWordCount: number,
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
  confirmReceipt(db, id, supervisorId, { externalConfirmedWordCount: workWordCount });
  startTask(db, id, proofreaderId);
  finishTask(db, id, proofreaderId);
  setPublished(id, publishedDaysAgo);
  setFinished(id, finishedDaysAgo);
  // 历史闭环：补齐配送与收货（只追加 INSERT），时间顺序 published < confirmed < started < finished < delivered < received。
  setConfirmedAt(id, finishedDaysAgo + 2);
  setStartedAt(id, finishedDaysAgo + 1);
  const deliveryId = insertDelivery(id, supervisorId, finishedDaysAgo - 1);
  insertReceipt(deliveryId, editorId, finishedDaysAgo - 2);
  return id;
}

// 2025 年（约 200+ 天前）与 2026 年（约 30~200 天前）各若干。
const hist = [
  [U.editors[0], "【演示】报表·2025甲", "FIRST_PROOF", 1, C.companyA, U.supervisor, U.proofreaders[0], 100000, 400, 395],
  [U.editors[1], "【演示】报表·2025乙", "FIRST_PROOF", 1, C.companyA, U.supervisor, U.proofreaders[1], 80000, 380, 374],
  [U.editors[2], "【演示】报表·2025丙", "SECOND_PROOF", 2, C.companyA, U.supervisor, U.proofreaders[2], 120000, 350, 344],
  [U.editors[0], "【演示】报表·2026甲", "FIRST_PROOF", 1, C.companyA, U.supervisor, U.proofreaders[0], 90000, 200, 195],
  [U.editors[1], "【演示】报表·2026乙", "FIRST_PROOF", 1, C.companyA, U.supervisor, U.proofreaders[1], 70000, 150, 145],
  [U.editors[3], "【演示】报表·2026丙", "THIRD_PROOF", 3, C.companyA, U.supervisor, U.proofreaders[3], 150000, 120, 116],
  [U.editors[4], "【演示】报表·2026丁", "FIRST_PROOF", 2, C.companyA, U.supervisor, U.proofreaders[4], 85000, 90, 86],
  [U.editors[5], "【演示】报表·2026戊", "INITIAL_REVIEW", 1, C.companyA, U.supervisor, U.proofreaders[5], 60000, 60, 57],
  [U.editors[6], "【演示】报表·2026己", "FIRST_PROOF", 1, C.companyA, U.supervisor, U.proofreaders[0], 65000, 45, 42],
  [U.editors[0], "【演示】报表·2026超期", "FIRST_PROOF", 1, C.companyA, U.supervisor, U.proofreaders[1], 140000, 100, 60],
];
for (const [e, title, stage, star, comp, sup, pf, wc, pd, fd] of hist) {
  reportCompleted(e as number, title as string, stage as string, star as number, comp as number, sup as number, pf as number, wc as number, pd as number, fd as number);
}
// 字数缺失样本
const missWork = reportCompleted(U.editors[1], "【演示】报表·缺工作字数", "SECOND_PROOF", 2, C.companyA, U.supervisor, U.proofreaders[4], 90000, 210, 205);
db.prepare("UPDATE tasks SET work_word_count = NULL WHERE id = ?").run(missWork);
const missConfirm = reportCompleted(U.editors[2], "【演示】报表·缺确认字数", "FIRST_PROOF", 1, C.companyA, U.supervisor, U.proofreaders[5], 95000, 220, 214);
db.prepare("UPDATE tasks SET external_confirmed_word_count = NULL WHERE id = ?").run(missConfirm);
// 公司B 历史（用于公司隔离）
reportCompleted(U.editors[0], "【演示】报表·B公司", "FIRST_PROOF", 1, C.companyB, U.supervisorB, U.proofreaders[7], 50000, 130, 126);
reportCompleted(U.editors[1], "【演示】报表·B公司2", "FIRST_PROOF", 1, C.companyB, U.supervisorB, U.proofreaders[8], 45000, 100, 96);

// ===== 10. 报表当前滞留样本（仍未完成，进入滞留量）=====
const rStuck = toReady(U.editors[0], "【演示】报表·当前滞留", "FIRST_PROOF", 1, "PROOFREAD", C.companyA, 110000);
setPublished(rStuck, 95);

// ===== 11. 进行中 IN_PROGRESS（3 条：正常 / 滞留 / B公司）=====
// 放在最末：复用 toInProgress，不调用 finish，3 名不同校对人员，公司归属一致；
// 对应校对人员登录后可点「结束校对」；editor_a 借此获得 proofreading + overdue 动画。
toInProgress(U.editors[0], "【演示】进行中·一校正常", "FIRST_PROOF", 1, "PROOFREAD", C.companyA, U.proofreaders[0], 68000);
const inProgressOverdue = toInProgress(U.editors[0], "【演示】进行中·急稿滞留", "FIRST_PROOF", 2, "PROOFREAD", C.companyA, U.proofreaders[1], 72000);
setPublished(inProgressOverdue, 18); // 2 星阈值 15 天，18 天 → 生产线滞留（overdue 动画 + 总控预警）
toInProgress(U.editors[1], "【演示】进行中·B公司正常", "FIRST_PROOF", 1, "PROOFREAD", C.companyB, U.proofreaders[6], 55000);

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

// 关闭并原子替换目标演示库。
db.close();
for (const ext of ["", "-wal", "-shm", "-journal"]) {
  const old = DEMO_DB + ext;
  if (fs.existsSync(old)) fs.rmSync(old, { force: true });
}
fs.renameSync(TMP_DB, DEMO_DB);
console.log("演示数据库生成完成。");
