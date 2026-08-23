import type Database from "better-sqlite3";
import { STAGE_LABELS, STATUS_LABELS, type DashboardTask } from "./dashboard-service.ts";
import { STAGES } from "./task-service.ts";

// ===== 任务列表只读筛选服务 =====
// 只读，从真实 tasks/books/users/companies 按“责任编辑 / 校对负责人 / 校次 / 状态”筛选，
// 全部参数绑定，防止 SQL 注入；不修改任何业务表。

// 可筛选的状态全集（含已取消，历史记录可查看）。
export const FILTER_STATUSES = [
  "PENDING_CONFIRMATION",
  "READY_TO_START",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;

export interface TaskFilter {
  editorId: number | null;
  proofreaderId: number | null;
  stage: string | null;
  status: string | null;
}

export interface NamedOption {
  id: number;
  display_name: string;
}

export interface ValueLabelOption {
  value: string;
  label: string;
}

export interface TaskFilterOptions {
  editors: NamedOption[];
  proofreaders: NamedOption[];
  stages: ValueLabelOption[];
  statuses: ValueLabelOption[];
}

const BASE_SELECT = `
  SELECT t.id, b.id AS bookId, b.editor_id AS editorId, b.title,
         t.stage, t.work_type AS workType, t.star_level AS starLevel,
         t.published_at AS publishedAt, t.status,
         t.work_word_count AS workWordCount,
         t.external_confirmed_word_count AS externalConfirmedWordCount,
         t.proofreader_id AS proofreaderId, t.started_at AS startedAt, t.finished_at AS finishedAt,
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

// 下拉选项：列出所有责任编辑与校对人员（含已停用，保证其历史书稿仍可被筛选到）。
export function listFilterOptions(db: Database.Database): TaskFilterOptions {
  const editors = db
    .prepare(
      "SELECT id, display_name FROM users WHERE role = 'RESPONSIBLE_EDITOR' ORDER BY display_name, id",
    )
    .all() as NamedOption[];
  const proofreaders = db
    .prepare(
      "SELECT id, display_name FROM users WHERE role = 'PROOFREADER' ORDER BY display_name, id",
    )
    .all() as NamedOption[];

  return {
    editors,
    proofreaders,
    stages: (STAGES as readonly string[]).map((s) => ({
      value: s,
      label: STAGE_LABELS[s] ?? s,
    })),
    statuses: FILTER_STATUSES.map((s) => ({
      value: s,
      label: STATUS_LABELS[s] ?? s,
    })),
  };
}

// 将浏览器传来的 searchParams 解析为安全筛选条件；非法值一律忽略为 null。
export function parseTaskFilter(
  sp: Record<string, string | string[] | undefined>,
): TaskFilter {
  const first = (v: string | string[] | undefined): string | null => {
    if (Array.isArray(v)) return v[0] ?? null;
    if (typeof v === "string" && v.length > 0) return v;
    return null;
  };
  const toId = (v: string | string[] | undefined): number | null => {
    const s = first(v);
    if (!s) return null;
    const n = Number.parseInt(s, 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  const stage = first(sp.stage);
  const status = first(sp.status);
  return {
    editorId: toId(sp.editor),
    proofreaderId: toId(sp.proofreader),
    stage: stage != null && (STAGES as readonly string[]).includes(stage) ? stage : null,
    status: status != null && (FILTER_STATUSES as readonly string[]).includes(status) ? status : null,
  };
}

export function hasActiveFilter(f: TaskFilter): boolean {
  return f.editorId != null || f.proofreaderId != null || f.stage != null || f.status != null;
}

// 按条件 AND 组合筛选全部任务（含已取消），发布时间倒序稳定排序。
export function filterTasks(
  db: Database.Database,
  filter: TaskFilter,
): DashboardTask[] {
  const conditions: string[] = [];
  const params: (number | string)[] = [];

  if (filter.editorId != null) {
    conditions.push("b.editor_id = ?");
    params.push(filter.editorId);
  }
  if (filter.proofreaderId != null) {
    conditions.push("t.proofreader_id = ?");
    params.push(filter.proofreaderId);
  }
  if (filter.stage != null) {
    conditions.push("t.stage = ?");
    params.push(filter.stage);
  }
  if (filter.status != null) {
    conditions.push("t.status = ?");
    params.push(filter.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return db
    .prepare(`${BASE_SELECT} ${where} ORDER BY t.published_at DESC, t.id DESC`)
    .all(...params) as DashboardTask[];
}
