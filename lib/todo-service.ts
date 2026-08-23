import type Database from "better-sqlite3";
import {
  waitDays,
  overdueThresholdDays,
  type DashboardTask,
} from "./dashboard-service.ts";

// ===== 站内待办查询服务 =====
// 只读，从真实 tasks/books/users/companies 实时生成各角色的“我的待办”。

export type TodoGroup = "urgent" | "waiting" | "in_progress" | "completed";

export interface TodoItem extends DashboardTask {
  waitDays: number;
  overdueDays: number;
  group: TodoGroup;
  actionHint: string;
}

export interface TodoSummary {
  items: TodoItem[];
  activeCount: number; // urgent + waiting + in_progress（不含已完成）
  completedCount: number;
  urgentCount: number;
  waitingCount: number;
  inProgressCount: number;
}

export interface TodoUser {
  id: number;
  role: string;
  companyId: number | null;
}

const GROUP_ORDER: Record<TodoGroup, number> = {
  urgent: 0,
  waiting: 1,
  in_progress: 2,
  completed: 3,
};

function matchesRole(task: DashboardTask, user: TodoUser): boolean {
  switch (user.role) {
    case "INTERNAL_ADMIN":
      return true;
    case "RESPONSIBLE_EDITOR":
      return task.editorId === user.id;
    case "EXTERNAL_SUPERVISOR":
      // 外校主管的“我的待办”只含待确认收稿；确认后即进入书稿仓库，不再是其待办。
      return task.companyId === user.companyId && task.status === "PENDING_CONFIRMATION";
    case "PROOFREADER":
      // 校对人员待办只含本人当前进行中的任务（最多 1 条），不显示仓库待开始任务或最近完成。
      return task.proofreaderId === user.id && task.status === "IN_PROGRESS";
    default:
      return false;
  }
}

function actionHint(
  task: DashboardTask,
  user: TodoUser,
  overdueDays: number,
  hasInProgress: boolean,
): string {
  if (task.status === "COMPLETED") return "已完成";
  if (task.status === "IN_PROGRESS") {
    if (user.role === "PROOFREADER" && task.proofreaderId === user.id) return "我的当前任务";
    return "正在校对";
  }
  if (user.role === "EXTERNAL_SUPERVISOR" && task.status === "PENDING_CONFIRMATION")
    return "请确认收稿";
  if (user.role === "PROOFREADER" && task.status === "READY_TO_START") {
    if (hasInProgress) return "你已有正在校对的任务，请先完成当前任务";
    return "可开始校对";
  }
  if (overdueDays > 0) return `已滞留 ${overdueDays} 天`;
  if (task.status === "PENDING_CONFIRMATION") return "待外校主管确认收稿";
  return "待校对人员开始";
}

const BASE = `
  SELECT t.id, b.id AS bookId, b.editor_id AS editorId, b.title,
         t.stage, t.work_type AS workType, t.star_level AS starLevel,
         t.published_at AS publishedAt, t.status,
         t.work_word_count AS workWordCount,
         t.external_confirmed_word_count AS externalConfirmedWordCount,
         t.proofreader_id AS proofreaderId, t.started_at AS startedAt, t.finished_at AS finishedAt,
         u.display_name AS editorName, cu.name AS publisherCompanyName,
         c.name AS companyName, t.company_id AS companyId,
         pu.display_name AS proofreaderName
  FROM tasks t
  JOIN books b ON b.id = t.book_id
  LEFT JOIN users u ON u.id = t.publisher_id
  LEFT JOIN companies cu ON cu.id = u.company_id
  LEFT JOIN companies c ON c.id = t.company_id
  LEFT JOIN users pu ON pu.id = t.proofreader_id
`;

export function listMyTodos(
  db: Database.Database,
  user: TodoUser,
  now: Date = new Date(),
): TodoSummary {
  const tasks = db.prepare(BASE).all() as DashboardTask[];

  const matched = tasks.filter(
    (task) => matchesRole(task, user) && task.status !== "CANCELLED",
  );
  const hasInProgress = matched.some(
    (task) => task.proofreaderId === user.id && task.status === "IN_PROGRESS",
  );

  const items: TodoItem[] = [];
  for (const task of matched) {
    const days = waitDays(task.publishedAt, now);
    const threshold = overdueThresholdDays(task.stage, task.starLevel);
    const overdueDays = days - threshold;
    const isActive =
      task.status === "PENDING_CONFIRMATION" ||
      task.status === "READY_TO_START" ||
      task.status === "IN_PROGRESS";

    const group: TodoGroup =
      task.status === "COMPLETED"
        ? "completed"
        : isActive && overdueDays > 0
          ? "urgent"
          : task.status === "IN_PROGRESS"
            ? "in_progress"
            : "waiting";

    items.push({
      ...task,
      waitDays: days,
      overdueDays: Math.max(0, overdueDays),
      group,
      actionHint: actionHint(task, user, overdueDays, hasInProgress),
    });
  }

  items.sort((a, b) => {
    const g = GROUP_ORDER[a.group] - GROUP_ORDER[b.group];
    if (g !== 0) return g;
    if (b.starLevel !== a.starLevel) return b.starLevel - a.starLevel;
    if (b.waitDays !== a.waitDays) return b.waitDays - a.waitDays;
    const pub = a.publishedAt.localeCompare(b.publishedAt);
    if (pub !== 0) return pub;
    return a.id - b.id;
  });

  const count = (g: TodoGroup) => items.filter((i) => i.group === g).length;
  const urgentCount = count("urgent");
  const waitingCount = count("waiting");
  const inProgressCount = count("in_progress");
  const completedCount = count("completed");

  return {
    items,
    activeCount: urgentCount + waitingCount + inProgressCount,
    completedCount,
    urgentCount,
    waitingCount,
    inProgressCount,
  };
}
