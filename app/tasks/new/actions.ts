"use server";

import { getCurrentUser } from "@/lib/session";
import { openDatabase } from "@/lib/db";
import { publishTask, taskErrorMessage } from "@/lib/task-service";

export type PublishActionResult =
  | {
      ok: true;
      taskId: number;
      title: string;
      stage: string;
      workType: string;
      starLevel: number;
      editorName: string;
      companyName: string | null;
      publishedAt: string;
    }
  | { ok: false; message: string };

// 只从服务器会话取得实际操作人，不接受浏览器传入的 operatorId / 角色 / 时间。
async function currentUserIdOrError(): Promise<{ id: number } | { error: string }> {
  const current = await getCurrentUser();
  if (!current) return { error: "未登录或会话已失效，请重新登录" };
  if (current.must_change_password === 1) return { error: "请先完成首次改密" };
  if (current.role !== "RESPONSIBLE_EDITOR" && current.role !== "INTERNAL_ADMIN") {
    return { error: "无权限：仅责任编辑或超级管理员可发布" };
  }
  return { id: current.id };
}

export async function publishTaskAction(input: {
  bookMode: "new" | "existing";
  bookId?: number;
  bookTitle?: string;
  stage: string;
  starLevel: number;
  workType?: string;
  companyId: number;
  note?: string;
  editorId?: number;
  proxyReason?: string;
}): Promise<PublishActionResult> {
  const who = await currentUserIdOrError();
  if ("error" in who) return { ok: false, message: who.error };

  if (!input.companyId) {
    return { ok: false, message: "请选择接收外校公司" };
  }

  const db = openDatabase();
  try {
    const taskId = publishTask(db, {
      operatorId: who.id,
      bookId: input.bookMode === "existing" ? input.bookId : undefined,
      bookTitle: input.bookMode === "new" ? input.bookTitle : undefined,
      stage: input.stage,
      starLevel: input.starLevel,
      workType: input.workType,
      note: input.note,
      companyId: input.companyId,
      editorId: input.editorId,
      proxyReason: input.proxyReason,
    });

    const row = db
      .prepare(
        `SELECT t.id, b.title, t.stage, t.work_type, t.star_level, t.published_at,
                u.display_name AS editorName, c.name AS companyName
         FROM tasks t
         JOIN books b ON b.id = t.book_id
         LEFT JOIN users u ON u.id = t.publisher_id
         LEFT JOIN companies c ON c.id = t.company_id
         WHERE t.id = ?`,
      )
      .get(taskId) as {
        id: number;
        title: string;
        stage: string;
        work_type: string;
        star_level: number;
        published_at: string;
        editorName: string | null;
        companyName: string | null;
      };

    return {
      ok: true,
      taskId: row.id,
      title: row.title,
      stage: row.stage,
      workType: row.work_type,
      starLevel: row.star_level,
      editorName: row.editorName ?? "",
      companyName: row.companyName,
      publishedAt: row.published_at,
    };
  } catch (e) {
    return { ok: false, message: taskErrorMessage(e) };
  } finally {
    db.close();
  }
}
