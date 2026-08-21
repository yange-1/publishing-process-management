import type Database from "better-sqlite3";

// ===== 首页/仪表盘集中只读查询服务 =====
// 状态口径与滞留阈值在此集中定义，避免各组件重复写不同口径的 SQL。

export interface DashboardTask {
  id: number;
  title: string;
  stage: string;
  starLevel: number;
  editorName: string | null;
  publisherCompanyName: string | null;
  companyName: string | null;
  companyId: number | null;
  publishedAt: string;
  status: string;
  proofreaderId: number | null;
  proofreaderName: string | null;
  startedAt: string | null;
}

export const STAGE_LABELS: Record<string, string> = {
  INITIAL_REVIEW: "初审",
  FIRST_PROOF: "一校",
  SECOND_PROOF: "二校",
  THIRD_PROOF: "三校",
  ADDITIONAL_PROOF: "加校",
  RED_CHECK: "核红",
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
  return "待确认";
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
  SELECT t.id, b.title, t.stage, t.star_level AS starLevel,
         t.published_at AS publishedAt, t.status,
         t.proofreader_id AS proofreaderId, t.started_at AS startedAt,
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

// 书稿仓库：已发布但尚未进入生产线的任务（待确认收稿 + 待开始）。
export function listWarehouse(db: Database.Database): DashboardTask[] {
  return db
    .prepare(
      `${BASE_SELECT} WHERE t.status IN ('PENDING_CONFIRMATION','READY_TO_START') ${ORDER_STAR_TIME}`,
    )
    .all() as DashboardTask[];
}

// 生产线：进行中。
export function listProduction(db: Database.Database): DashboardTask[] {
  return db
    .prepare(`${BASE_SELECT} WHERE t.status = 'IN_PROGRESS' ${ORDER_STAR_TIME}`)
    .all() as DashboardTask[];
}

// 已完成。
export function listCompleted(db: Database.Database): DashboardTask[] {
  return db
    .prepare(`${BASE_SELECT} WHERE t.status = 'COMPLETED' ORDER BY t.published_at DESC, t.id DESC`)
    .all() as DashboardTask[];
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
    .sort((a, b) => b.exceedDays - a.exceedDays || b.starLevel - a.starLevel || a.id - b.id);
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

export function countWarehouse(db: Database.Database): number {
  return (
    db
      .prepare(
        "SELECT COUNT(*) c FROM tasks WHERE status IN ('PENDING_CONFIRMATION','READY_TO_START')",
      )
      .get() as { c: number }
  ).c;
}

export function countProduction(db: Database.Database): number {
  return (db.prepare("SELECT COUNT(*) c FROM tasks WHERE status = 'IN_PROGRESS'").get() as { c: number }).c;
}

export function countCompleted(db: Database.Database): number {
  return (db.prepare("SELECT COUNT(*) c FROM tasks WHERE status = 'COMPLETED'").get() as { c: number }).c;
}
