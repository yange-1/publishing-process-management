import type Database from "better-sqlite3";

// ===== 书稿搜索与校对历史只读查询服务 =====
// 只读，不修改任何业务表；参数绑定，防止 SQL 注入。

export const EVENT_LABELS: Record<string, string> = {
  TASK_PUBLISHED: "发布校对任务",
  RECEIPT_CONFIRMED: "确认收稿",
  TASK_STARTED: "开始校对",
  TASK_COMPLETED: "结束校对",
  TASK_CANCELLED: "取消任务",
};

export const ROLE_LABELS: Record<string, string> = {
  INTERNAL_ADMIN: "Dominance",
  RESPONSIBLE_EDITOR: "责任编辑",
  EXTERNAL_SUPERVISOR: "外校主管",
  PROOFREADER: "校对人员",
};

// 代操作事件类型 → audit_log 操作类型
const PROXY_OPERATION_BY_EVENT: Record<string, string> = {
  TASK_PUBLISHED: "PROXY_PUBLISH",
  RECEIPT_CONFIRMED: "PROXY_CONFIRM",
  TASK_STARTED: "PROXY_START",
  TASK_COMPLETED: "PROXY_FINISH",
};

// 转义 LIKE 通配符，使 %、_、\ 作为字面量匹配。
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => "\\" + c);
}

export interface SearchResultItem {
  bookId: number;
  taskId: number | null;
  title: string;
  editorName: string | null;
  publisherCompanyName: string | null;
  stage: string | null;
  workType: string | null;
  starLevel: number | null;
  status: string | null;
  companyId: number | null;
  companyName: string | null;
  publishedAt: string | null;
  confirmedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  proofreaderName: string | null;
}

export function searchBooks(
  db: Database.Database,
  q: string,
  page = 1,
  pageSize = 20,
): { results: SearchResultItem[]; total: number; page: number; pageSize: number } {
  const query = q.trim();
  if (!query) return { results: [], total: 0, page, pageSize };
  const pattern = `%${escapeLike(query)}%`;
  const offset = (page - 1) * pageSize;

  const total = (
    db
      .prepare(
        `SELECT COUNT(*) c FROM books b
         LEFT JOIN users ed ON ed.id = b.editor_id
         WHERE b.title LIKE ? ESCAPE '\\' OR ed.display_name LIKE ? ESCAPE '\\'`,
      )
      .get(pattern, pattern) as { c: number }
  ).c;

  const results = db
    .prepare(
      `SELECT b.id AS bookId, b.title,
              ed.display_name AS editorName,
              ced.name AS publisherCompanyName,
              t.id AS taskId, t.stage, t.work_type AS workType, t.star_level AS starLevel, t.status,
              t.company_id AS companyId,
              t.published_at AS publishedAt, t.confirmed_at AS confirmedAt,
              t.started_at AS startedAt, t.finished_at AS finishedAt,
              c.name AS companyName,
              pu.display_name AS proofreaderName
       FROM books b
       LEFT JOIN tasks t ON t.id = (SELECT MAX(t2.id) FROM tasks t2 WHERE t2.book_id = b.id)
       LEFT JOIN users ed ON ed.id = b.editor_id
       LEFT JOIN companies ced ON ced.id = ed.company_id
       LEFT JOIN companies c ON c.id = t.company_id
       LEFT JOIN users pu ON pu.id = t.proofreader_id
       WHERE b.title LIKE ? ESCAPE '\\' OR ed.display_name LIKE ? ESCAPE '\\'
       ORDER BY t.published_at DESC, b.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(pattern, pattern, pageSize, offset) as SearchResultItem[];

  return { results, total, page, pageSize };
}

// 校对人员在搜索结果中能否“开始校对”的纯 UI 判断（不涉及业务写入；实际开始仍由 startTask 校验）。
export interface SearchStartDecision {
  showStart: boolean; // 显示“开始校对”按钮
  showBusyHint: boolean; // 显示“你已有正在校对的任务”提示
}

export function proofreaderStartDecision(
  role: string,
  status: string | null,
  taskCompanyId: number | null,
  proofreaderCompanyId: number | null,
  hasInProgress: boolean,
): SearchStartDecision {
  const eligible =
    role === "PROOFREADER" &&
    status === "READY_TO_START" &&
    taskCompanyId != null &&
    taskCompanyId === proofreaderCompanyId;
  if (!eligible) return { showStart: false, showBusyHint: false };
  if (hasInProgress) return { showStart: false, showBusyHint: true };
  return { showStart: true, showBusyHint: false };
}

// 校对人员当前是否已有进行中的任务（服务端查询，不信任浏览器）。
export function hasInProgressTask(
  db: Database.Database,
  proofreaderId: number,
): boolean {
  return (
    (
      db
        .prepare(
          "SELECT COUNT(*) c FROM tasks WHERE proofreader_id = ? AND status = 'IN_PROGRESS'",
        )
        .get(proofreaderId) as { c: number }
    ).c > 0
  );
}

export interface BookTaskInfo {
  taskId: number;
  stage: string;
  workType: string;
  starLevel: number;
  status: string;
  publisherName: string | null;
  companyName: string | null;
  proofreaderName: string | null;
  publishedAt: string | null;
  confirmedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  cancelledAt: string | null;
  note: string | null;
}

export interface BookEventInfo {
  eventId: number;
  taskId: number;
  eventType: string;
  operatorName: string | null;
  operatorRole: string | null;
  isProxy: number;
  proxyRole: string | null;
  proxyReason: string | null;
  statusFrom: string | null;
  statusTo: string | null;
  occurredAt: string;
}

export interface BookDetail {
  bookId: number;
  title: string;
  editorName: string | null;
  publisherCompanyName: string | null;
  latestStatus: string | null;
  latestStage: string | null;
  latestCompanyName: string | null;
  latestProofreaderName: string | null;
  latestStarLevel: number | null;
  note: string | null;
  firstPublishedAt: string | null;
  latestUpdatedAt: string | null;
  tasks: BookTaskInfo[];
  events: BookEventInfo[];
}

export function getBookDetail(db: Database.Database, bookId: number): BookDetail | null {
  const book = db
    .prepare(
      `SELECT b.id, b.title, b.editor_id,
              ed.display_name AS editorName,
              ced.name AS publisherCompanyName
       FROM books b
       LEFT JOIN users ed ON ed.id = b.editor_id
       LEFT JOIN companies ced ON ced.id = ed.company_id
       WHERE b.id = ?`,
    )
    .get(bookId) as { id: number; title: string; editor_id: number | null; editorName: string | null; publisherCompanyName: string | null } | undefined;
  if (!book) return null;

  const tasks = db
    .prepare(
      `SELECT t.id AS taskId, t.stage, t.work_type AS workType, t.star_level AS starLevel, t.status, t.note,
              t.published_at AS publishedAt, t.confirmed_at AS confirmedAt,
              t.started_at AS startedAt, t.finished_at AS finishedAt,
              t.cancelled_at AS cancelledAt,
              u.display_name AS publisherName,
              c.name AS companyName,
              pu.display_name AS proofreaderName
       FROM tasks t
       LEFT JOIN users u ON u.id = t.publisher_id
       LEFT JOIN companies c ON c.id = t.company_id
       LEFT JOIN users pu ON pu.id = t.proofreader_id
       WHERE t.book_id = ?
       ORDER BY t.published_at ASC, t.id ASC`,
    )
    .all(bookId) as BookTaskInfo[];

  const taskIds = tasks.map((t) => t.taskId);
  const placeholders = taskIds.map(() => "?").join(",");

  let events: BookEventInfo[] = [];
  if (taskIds.length > 0) {
    events = db
      .prepare(
        `SELECT e.id AS eventId, e.task_id AS taskId, e.event_type AS eventType,
                e.operator_role AS operatorRole, e.is_proxy AS isProxy,
                e.proxy_role AS proxyRole, e.status_from AS statusFrom, e.status_to AS statusTo,
                e.occurred_at AS occurredAt,
                u.display_name AS operatorName
         FROM task_events e
         LEFT JOIN users u ON u.id = e.operator_id
         WHERE e.task_id IN (${placeholders})
         ORDER BY e.occurred_at ASC, e.id ASC`,
      )
      .all(...taskIds) as BookEventInfo[];

    // 代操作原因：从 audit_log 关联（target_id 为任务ID字符串）
    const audits = db
      .prepare(
        `SELECT target_id, operation_type, reason
         FROM audit_log
         WHERE target_id IN (${placeholders})`,
      )
      .all(...taskIds.map(String)) as { target_id: string; operation_type: string; reason: string }[];

    for (const ev of events) {
      if (ev.isProxy === 1) {
        const opType = PROXY_OPERATION_BY_EVENT[ev.eventType];
        if (opType) {
          const audit = audits.find(
            (a) => a.target_id === String(ev.taskId) && a.operation_type === opType,
          );
          if (audit) ev.proxyReason = audit.reason;
        }
      }
    }
  }

  const latestTask = tasks.length > 0 ? tasks[tasks.length - 1] : null;
  const firstPublishedAt = tasks.length > 0 ? tasks[0].publishedAt : null;
  const latestUpdatedAt =
    events.length > 0
      ? events[events.length - 1].occurredAt
      : latestTask?.finishedAt ?? latestTask?.startedAt ?? latestTask?.publishedAt ?? null;

  return {
    bookId: book.id,
    title: book.title,
    editorName: book.editorName,
    publisherCompanyName: book.publisherCompanyName,
    latestStatus: latestTask?.status ?? null,
    latestStage: latestTask?.stage ?? null,
    latestCompanyName: latestTask?.companyName ?? null,
    latestProofreaderName: latestTask?.proofreaderName ?? null,
    latestStarLevel: latestTask?.starLevel ?? null,
    note: latestTask?.note ?? null,
    firstPublishedAt,
    latestUpdatedAt,
    tasks,
    events,
  };
}
