"use server";

import { getCurrentUser } from "@/lib/session";
import { openDatabase } from "@/lib/db";
import {
  createUser,
  resetUserPassword,
  deactivateUser,
  activateUser,
  userAdminErrorMessage,
} from "@/lib/user-admin-service";

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

// 每次操作都从服务器会话 + 数据库回查取得真实管理员，绝不接受浏览器传入的
// operatorId / 角色 / 操作时间。此函数复用了 requireCurrentUser 底层的会话校验。
async function adminIdOrError(): Promise<{ id: number } | { error: string }> {
  const current = await getCurrentUser();
  if (!current) return { error: "未登录或会话已失效，请重新登录" };
  if (current.must_change_password === 1) return { error: "请先完成首次改密" };
  if (current.role !== "INTERNAL_ADMIN") return { error: "无权限执行此操作" };
  return { id: current.id };
}

export async function createUserAction(input: {
  username: string;
  displayName: string;
  role: string;
  companyName: string;
}): Promise<ActionResult> {
  const who = await adminIdOrError();
  if ("error" in who) return { ok: false, message: who.error };

  const db = openDatabase();
  try {
    createUser(db, who.id, {
      username: input.username,
      displayName: input.displayName,
      role: input.role,
      companyName: input.companyName,
    });
    return { ok: true, message: "账号已创建，初始密码为123456，首次登录必须修改密码。" };
  } catch (e) {
    return { ok: false, message: userAdminErrorMessage(e) };
  } finally {
    db.close();
  }
}

export async function resetUserPasswordAction(targetUserId: number): Promise<ActionResult> {
  const who = await adminIdOrError();
  if ("error" in who) return { ok: false, message: who.error };

  const db = openDatabase();
  try {
    resetUserPassword(db, who.id, targetUserId);
    return { ok: true, message: "密码已重置为123456，该用户下次登录必须修改密码。" };
  } catch (e) {
    return { ok: false, message: userAdminErrorMessage(e) };
  } finally {
    db.close();
  }
}

export async function deactivateUserAction(targetUserId: number): Promise<ActionResult> {
  const who = await adminIdOrError();
  if ("error" in who) return { ok: false, message: who.error };

  const db = openDatabase();
  try {
    deactivateUser(db, who.id, targetUserId);
    return { ok: true, message: "账号已停用，该用户将无法登录。" };
  } catch (e) {
    return { ok: false, message: userAdminErrorMessage(e) };
  } finally {
    db.close();
  }
}

export async function activateUserAction(targetUserId: number): Promise<ActionResult> {
  const who = await adminIdOrError();
  if ("error" in who) return { ok: false, message: who.error };

  const db = openDatabase();
  try {
    activateUser(db, who.id, targetUserId);
    return { ok: true, message: "账号已启用。" };
  } catch (e) {
    return { ok: false, message: userAdminErrorMessage(e) };
  } finally {
    db.close();
  }
}
