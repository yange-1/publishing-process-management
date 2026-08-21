"use server";

import { getCurrentUser } from "@/lib/session";
import { openDatabase } from "@/lib/db";
import { startTask, finishTask, taskErrorMessage } from "@/lib/task-service";

export type StartActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

// 只从服务器会话取得实际操作人，不接受浏览器传入的操作人、角色或时间。
export async function startTaskAction(input: {
  taskId: number;
  proofreaderId?: number;
  proxyReason?: string;
}): Promise<StartActionResult> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, message: "未登录或会话已失效，请重新登录" };
  if (current.must_change_password === 1) return { ok: false, message: "请先完成首次改密" };
  if (current.role !== "PROOFREADER" && current.role !== "INTERNAL_ADMIN") {
    return { ok: false, message: "无权限执行此操作" };
  }

  const db = openDatabase();
  try {
    startTask(db, input.taskId, current.id, {
      proofreaderId: input.proofreaderId,
      proxyReason: input.proxyReason,
    });
    return { ok: true, message: "已开始校对，任务已进入生产线" };
  } catch (e) {
    return { ok: false, message: taskErrorMessage(e) };
  } finally {
    db.close();
  }
}

export async function finishTaskAction(input: {
  taskId: number;
  proxyReason?: string;
}): Promise<StartActionResult> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, message: "未登录或会话已失效，请重新登录" };
  if (current.must_change_password === 1) return { ok: false, message: "请先完成首次改密" };
  if (current.role !== "PROOFREADER" && current.role !== "INTERNAL_ADMIN") {
    return { ok: false, message: "无权限执行此操作" };
  }

  const db = openDatabase();
  try {
    finishTask(db, input.taskId, current.id, { proxyReason: input.proxyReason });
    return { ok: true, message: "已结束校对，任务已完成" };
  } catch (e) {
    return { ok: false, message: taskErrorMessage(e) };
  } finally {
    db.close();
  }
}
