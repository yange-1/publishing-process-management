import type Database from "better-sqlite3";

// ===== 首页/仪表盘集中只读查询服务 =====
// 状态口径与滞留阈值在此集中定义，避免各组件重复写不同口径的 SQL。

export interface DashboardTask {
  id: number;
  bookId: number;
  title: string;
  stage: string;
  workType: string;
  starLevel: number;
  editorName: string | null;
  editorId: number | null;
  publisherCompanyName: string | null;
  companyName: string | null;
  companyId: number | null;
  publishedAt: string;
  status: string;
  proofreaderId: number | null;
  proofreaderName: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export const STAGE_LABELS: Record<string, string> = {
  INITIAL_REVIEW: "初审",
  FIRST_PROOF: "一校",
  SECOND_PROOF: "二校",
  THIRD_PROOF: "三校",
  ADDITIONAL_PROOF: "加校",
  RED_CHECK: "核红",
};

export const WORK_TYPE_LABELS: Record<string, string> = {
  PROOFREAD: "读校",
  RED_CHECK: "核红",
  PROOFREAD_AND_RED_CHECK: "读校且核红",
};

export const STATUS_LABELS: Record<string, string> = {
  PENDING_CONFIRMATION: "待确认收稿",
  READY_TO_START: "待开始",
  IN_PROGRESS: "进行中",
  COMPLETED: "已结束",
  CANCELLED: "已取消",
};

// 滞留预警中的“所处位置”。
export function locationLabel(status: string): string {
  if (status === "IN_PROGRESS") return "生产线";
  if (status === "READY_TO_START") return "仓库";
  return "待确认收稿";
}

// 已等待天数：自 published_at 起算，使用服务器当前时间，不写回数据库。
export function waitDays(publishedAt: string, now: Date): number {
  const t = new Date(publishedAt).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / 86400000));
}

// 第一版滞留阈值：初审 90 天；非初审 1 星 30 天、2 星 15 天、3 星 7 天。
export function overdueThresholdDays(stage: string, starLevel: number): number {
  if (stage === "INITIAL_REVIEW") return 90;
  if (starLevel >= 3) return 7;
  if (starLevel === 2) return 15;
  return 30;
}

export interface OverdueInfo {
  days: number;
  threshold: number;
  overdueDays: number;
  isOverdue: boolean;
}

export function overdueInfo(task: DashboardTask, now: Date): OverdueInfo {
  const days = waitDays(task.publishedAt, now);
  const threshold = overdueThresholdDays(task.stage, task.starLevel);
  return {
    days,
    threshold,
    overdueDays: days - threshold,
    isOverdue: days > threshold,
  };
}

const BASE_SELECT = `
  SELECT t.id, b.id AS bookId, b.editor_id AS editorId, b.title, t.stage, t.work_type AS workType, t.star_level AS starLevel,
         t.published_at AS publishedAt, t.status,
         t.proofreader_id AS proofreaderId, t.started_at AS startedAt,
         t.finished_at AS finishedAt,
         u.display_name AS editorName,
         cu.name AS publisherCompanyName,
         c.name AS companyName,
         t.company_id AS companyId,
         pu.display_name AS proofreaderName
  FROM tasks t
  JOIN books b ON b.id = t.book_id
  LEFT JOIN users u ON u.id = t.publisher_id
  LEFT JOIN companies cu ON cu.id = u.company_id
  LEFT JOIN companies c ON c.id = t.company_id
  LEFT JOIN users pu ON pu.id = t.proofreader_id
`;

const ORDER_STAR_TIME = "ORDER BY t.star_level DESC, t.published_at ASC, t.id ASC";

// 书稿仓库：仅“待开始”（外校主管已确认收稿、等待校对人员开始）。
// 待确认收稿（PENDING_CONFIRMATION）单独进入“待确认收稿”专页，不进入仓库。
export function listWarehouse(db: Database.Database): DashboardTask[] {
  return db
    .prepare(
      `${BASE_SELECT} WHERE t.status = 'READY_TO_START' ${ORDER_STAR_TIME}`,
    )
    .all() as DashboardTask[];
}

// 生产线：进行中。
export function listProduction(db: Database.Database): DashboardTask[] {
  return db
    .prepare(`${BASE_SELECT} WHERE t.status = 'IN_PROGRESS' ${ORDER_STAR_TIME}`)
    .all() as DashboardTask[];
}

// 责任编辑：本人书稿的进行中任务。
export function listProductionByEditor(
  db: Database.Database,
  editorId: number,
): DashboardTask[] {
  return db
    .prepare(`${BASE_SELECT} WHERE t.status = 'IN_PROGRESS' AND b.editor_id = ? ${ORDER_STAR_TIME}`)
    .all(editorId) as DashboardTask[];
}

// 已完成。
export function listCompleted(db: Database.Database): DashboardTask[] {
  return db
    .prepare(`${BASE_SELECT} WHERE t.status = 'COMPLETED' ORDER BY t.published_at DESC, t.id DESC`)
    .all() as DashboardTask[];
}

// 责任编辑：本人书稿的已完成任务（按完成时间倒序）。
export function listCompletedByEditor(
  db: Database.Database,
  editorId: number,
): DashboardTask[] {
  return db
    .prepare(`${BASE_SELECT} WHERE t.status = 'COMPLETED' AND b.editor_id = ? ORDER BY t.finished_at DESC, t.id DESC`)
    .all(editorId) as DashboardTask[];
}

export interface CompletedPage {
  items: DashboardTask[];
  total: number;
}

// 已完成分页查询：按完成时间从新到旧；companyId 提供时只返回该公司（外校主管）。
export function listCompletedPage(
  db: Database.Database,
  companyId: number | null,
  page: number,
  pageSize: number,
): CompletedPage {
  const conditions = ["t.status = 'COMPLETED'"];
  const params: (number | string)[] = [];
  if (companyId != null) {
    conditions.push("t.company_id = ?");
    params.push(companyId);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const total = (
    db.prepare(`SELECT COUNT(*) c FROM tasks t ${where}`).get(...params) as { c: number }
  ).c;
  const offset = (page - 1) * pageSize;
  const items = db
    .prepare(`${BASE_SELECT} ${where} ORDER BY t.finished_at DESC, t.id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset) as DashboardTask[];
  return { items, total };
}

export interface OverdueItem extends DashboardTask {
  waitDays: number;
  thresholdDays: number;
  exceedDays: number;
  location: string;
}

// 总控预警：未完成任务中超过阈值的任务，超出天数从多到少、同超出星级优先。
export function listOverdue(
  db: Database.Database,
  now: Date = new Date(),
): OverdueItem[] {
  const rows = db
    .prepare(
      `${BASE_SELECT} WHERE t.status IN ('PENDING_CONFIRMATION','READY_TO_START','IN_PROGRESS')`,
    )
    .all() as DashboardTask[];
  return rows
    .map((t) => {
      const days = waitDays(t.publishedAt, now);
      const threshold = overdueThresholdDays(t.stage, t.starLevel);
      return {
        ...t,
        waitDays: days,
        thresholdDays: threshold,
        exceedDays: days - threshold,
        location: locationLabel(t.status),
      };
    })
    .filter((r) => r.exceedDays > 0)
    .sort(
      (a, b) =>
        b.exceedDays - a.exceedDays ||
        b.starLevel - a.starLevel ||
        a.publishedAt.localeCompare(b.publishedAt) ||
        a.id - b.id,
    );
}

// 部门现有书稿：处于待确认/待开始/进行中的不同书稿数量。
export function countActiveBooks(db: Database.Database): number {
  return (
    db
      .prepare(
        "SELECT COUNT(DISTINCT book_id) c FROM tasks WHERE status IN ('PENDING_CONFIRMATION','READY_TO_START','IN_PROGRESS')",
      )
      .get() as { c: number }
  ).c;
}

// 责任编辑：本人书稿中处于活动状态（待确认/待开始/进行中）的去重书稿数量。
export function countActiveBooksByEditor(
  db: Database.Database,
  editorId: number,
): number {
  return (
    db
      .prepare(
        "SELECT COUNT(DISTINCT t.book_id) c FROM tasks t JOIN books b ON b.id = t.book_id WHERE t.status IN ('PENDING_CONFIRMATION','READY_TO_START','IN_PROGRESS') AND b.editor_id = ?",
      )
      .get(editorId) as { c: number }
  ).c;
}

export interface CompanyWarehouseCount {
  companyId: number | null;
  companyName: string | null;
  count: number;
}

// 各外校公司的书稿仓库（READY_TO_START）数量，用于责任编辑判断承载情况。
export function countWarehouseByCompany(
  db: Database.Database,
): CompanyWarehouseCount[] {
  return db
    .prepare(
      `SELECT t.company_id AS companyId, c.name AS companyName, COUNT(*) AS count
       FROM tasks t
       LEFT JOIN companies c ON c.id = t.company_id
       WHERE t.status = 'READY_TO_START'
       GROUP BY t.company_id
       ORDER BY c.name, t.company_id`,
    )
    .all() as CompanyWarehouseCount[];
}

export function countWarehouse(db: Database.Database): number {
  return (db.prepare("SELECT COUNT(*) c FROM tasks WHERE status = 'READY_TO_START'").get() as { c: number }).c;
}

export function countProduction(db: Database.Database): number {
  return (db.prepare("SELECT COUNT(*) c FROM tasks WHERE status = 'IN_PROGRESS'").get() as { c: number }).c;
}

export function countCompleted(db: Database.Database): number {
  return (db.prepare("SELECT COUNT(*) c FROM tasks WHERE status = 'COMPLETED'").get() as { c: number }).c;
}
