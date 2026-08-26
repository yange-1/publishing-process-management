"use server";

import { getCurrentUser } from "@/lib/session";
import { openDatabase } from "@/lib/db";
import { startTask, finishTask, cancelTask, taskErrorMessage } from "@/lib/task-service";
import { deliverTask, confirmDeliveryReceipt } from "@/lib/delivery-service";

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

export async function cancelTaskAction(input: {
  taskId: number;
  reason: string;
}): Promise<StartActionResult> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, message: "未登录或会话已失效，请重新登录" };
  if (current.must_change_password === 1) return { ok: false, message: "请先完成首次改密" };
  if (current.role !== "RESPONSIBLE_EDITOR" && current.role !== "INTERNAL_ADMIN") return { ok: false, message: "无权限执行此操作" };

  const db = openDatabase();
  try {
    cancelTask(db, input.taskId, current.id, input.reason);
    return { ok: true, message: "任务已取消" };
  } catch (e) {
    return { ok: false, message: taskErrorMessage(e) };
  } finally {
    db.close();
  }
}

// 送达：外校主管送达本公司任务；Dominance 代送达（须填原因）。
// 只从服务器会话取得操作人，不信任浏览器传入的操作人、公司或时间。
export async function deliverTaskAction(input: {
  taskId: number;
  proxyReason?: string;
}): Promise<StartActionResult> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, message: "未登录或会话已失效，请重新登录" };
  if (current.must_change_password === 1) return { ok: false, message: "请先完成首次改密" };
  if (current.role !== "EXTERNAL_SUPERVISOR" && current.role !== "INTERNAL_ADMIN") {
    return { ok: false, message: "无权限执行此操作" };
  }

  const db = openDatabase();
  try {
    const result = deliverTask(db, input.taskId, current.id, {
      proxyReason: input.proxyReason,
    });
    if (result === "already_delivered") {
      return { ok: true, message: "该任务已送达" };
    }
    return { ok: true, message: "已送达" };
  } catch (e) {
    return { ok: false, message: taskErrorMessage(e) };
  } finally {
    db.close();
  }
}

// 确认收到：仅对应责任编辑本人可确认；操作人、确认时间取自服务器会话，不信任浏览器。
export async function confirmDeliveryReceiptAction(input: {
  taskId: number;
}): Promise<StartActionResult> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, message: "未登录或会话已失效，请重新登录" };
  if (current.must_change_password === 1) return { ok: false, message: "请先完成首次改密" };
  if (current.role !== "RESPONSIBLE_EDITOR") {
    return { ok: false, message: "无权限执行此操作" };
  }

  const db = openDatabase();
  try {
    const result = confirmDeliveryReceipt(db, input.taskId, current.id);
    if (result === "already_confirmed") {
      return { ok: true, message: "该稿件已确认收到" };
    }
    return { ok: true, message: "已确认收到" };
  } catch (e) {
    return { ok: false, message: taskErrorMessage(e) };
  } finally {
    db.close();
  }
}
