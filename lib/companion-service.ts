import type Database from "better-sqlite3";
import {
  listActiveTasksByEditor,
  listInTransitByEditor,
  listDeliveredUnconfirmedByEditor,
  overdueInfo,
  type DashboardTask,
} from "./dashboard-service.ts";
import { recentDeliveryCutoffMs } from "./delivery-service.ts";

// ===== 桌面伴侣只读服务 =====
// 以“任务（task）”为一份书稿状态单元，manuscriptId 使用 task.id。
// 只读：不写数据库、不复制状态流转、不新增迁移。

// delivered 仅用于变化检测与语音，不进入动画轮播。
export type CompanionState = "overdue" | "delivering" | "proofreading" | "queued" | "delivered";

export interface CompanionManuscript {
  manuscriptId: string;
  title: string;
  stage: string;
  state: CompanionState;
  updatedAt: string;
}

const STATE_PRIORITY: Record<CompanionState, number> = {
  overdue: 0,
  delivering: 1,
  proofreading: 2,
  queued: 3,
  delivered: 4,
};

// 稳定时间：按状态选取现有真实字段，绝不写入当前时间。
function stableUpdatedAt(task: DashboardTask, state: CompanionState): string {
  if (state === "proofreading") return task.startedAt ?? task.publishedAt ?? "";
  if (state === "delivering") return task.finishedAt ?? task.publishedAt ?? "";
  if (state === "overdue" && task.status === "IN_PROGRESS") {
    return task.startedAt ?? task.publishedAt ?? "";
  }
  return task.publishedAt ?? "";
}

// 责任编辑的桌面伴侣书稿列表：每项对应一个 task，同一 task 只返回一个 state。
export function listCompanionManuscripts(
  db: Database.Database,
  editorId: number,
  now: Date,
): CompanionManuscript[] {
  const result: CompanionManuscript[] = [];
  const seen = new Set<string>();

  const push = (
    task: DashboardTask,
    state: CompanionState,
    updatedAtOverride?: string,
  ): void => {
    const id = String(task.id);
    if (seen.has(id)) return;
    seen.add(id);
    result.push({
      manuscriptId: id,
      title: task.title,
      stage: task.stage,
      state,
      updatedAt: updatedAtOverride ?? stableUpdatedAt(task, state),
    });
  };

  // 1. 活动任务（待确认/待开始/进行中）→ overdue / proofreading / queued。
  for (const task of listActiveTasksByEditor(db, editorId)) {
    if (overdueInfo(task, now).isOverdue) {
      push(task, "overdue");
    } else if (task.status === "IN_PROGRESS") {
      push(task, "proofreading");
    } else {
      push(task, "queued"); // PENDING_CONFIRMATION 或 READY_TO_START
    }
  }

  // 2. 配送中（COMPLETED 且无 deliveries 记录）→ delivering。
  for (const task of listInTransitByEditor(db, editorId)) {
    push(task, "delivering");
  }

  // 3. 已送达未确认 → delivered（真实送达时间，仅变化检测与语音）。
  const cutoff = new Date(recentDeliveryCutoffMs(now)).toISOString();
  for (const task of listDeliveredUnconfirmedByEditor(db, editorId, cutoff)) {
    push(task, "delivered", task.deliveredAt);
  }

  // 排序稳定：state 优先级 → updatedAt → manuscriptId。
  result.sort((a, b) => {
    if (STATE_PRIORITY[a.state] !== STATE_PRIORITY[b.state]) {
      return STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state];
    }
    if (a.updatedAt !== b.updatedAt) {
      return a.updatedAt < b.updatedAt ? -1 : 1;
    }
    return a.manuscriptId.localeCompare(b.manuscriptId);
  });

  return result;
}
