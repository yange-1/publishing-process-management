"use server";

import { getCurrentUser } from "@/lib/session";
import { openDatabase } from "@/lib/db";
import { confirmReceipt, taskErrorMessage } from "@/lib/task-service";

export type ReceiptActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

// 只从服务器会话取得实际操作人，不接受浏览器传入的角色、公司或时间。
export async function confirmReceiptAction(input: {
  taskId: number;
  proxyReason?: string;
  externalConfirmedWordCount?: number;
}): Promise<ReceiptActionResult> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, message: "未登录或会话已失效，请重新登录" };
  if (current.must_change_password === 1) return { ok: false, message: "请先完成首次改密" };
  if (current.role !== "EXTERNAL_SUPERVISOR" && current.role !== "INTERNAL_ADMIN") {
    return { ok: false, message: "无权限执行此操作" };
  }
  if (
    input.externalConfirmedWordCount != null &&
    (!Number.isInteger(input.externalConfirmedWordCount) || input.externalConfirmedWordCount <= 0)
  ) {
    return { ok: false, message: "外校确认字数须为正整数" };
  }

  const db = openDatabase();
  try {
    const result = confirmReceipt(db, input.taskId, current.id, {
      proxyReason: input.proxyReason,
      externalConfirmedWordCount: input.externalConfirmedWordCount,
    });
    if (result === "already_confirmed") {
      return { ok: true, message: "该任务已被确认，无需重复操作" };
    }
    return { ok: true, message: "已确认收稿，任务状态已更新为待开始" };
  } catch (e) {
    return { ok: false, message: taskErrorMessage(e) };
  } finally {
    db.close();
  }
}
