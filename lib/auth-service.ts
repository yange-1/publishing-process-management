import type Database from "better-sqlite3";
import { hashPassword, verifyPassword, DEFAULT_PASSWORD } from "./password.ts";

const LOCK_THRESHOLD = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

export interface AuthUser {
  id: number;
  username: string;
  display_name: string;
  role: string;
  company_id: number | null;
  must_change_password: number;
  session_version: number;
}

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role: string;
  company_id: number | null;
  password_hash: string | null;
  is_active: number;
  failed_login_count: number;
  locked_until: string | null;
  must_change_password: number;
  session_version: number;
}

function toAuthUser(u: UserRow): AuthUser {
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    role: u.role,
    company_id: u.company_id,
    must_change_password: u.must_change_password,
    session_version: u.session_version,
  };
}

// 登录：返回用户或 null。账号不存在、密码错误、停用、锁定均返回 null（统一提示）。
export function authenticateUser(
  db: Database.Database,
  username: string,
  password: string,
): AuthUser | null {
  const user = db
    .prepare(
      "SELECT id, username, display_name, role, company_id, password_hash, is_active, failed_login_count, locked_until, must_change_password, session_version FROM users WHERE username = ?",
    )
    .get(username) as UserRow | undefined;

  if (!user) return null;
  if (user.is_active !== 1) return null;
  if (!user.password_hash) return null;
  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) return null;

  if (!verifyPassword(password, user.password_hash)) {
    const next = user.failed_login_count + 1;
    if (next >= LOCK_THRESHOLD) {
      const lockedUntil = new Date(Date.now() + LOCK_DURATION_MS).toISOString();
      db.prepare("UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?").run(next, lockedUntil, user.id);
    } else {
      db.prepare("UPDATE users SET failed_login_count = ? WHERE id = ?").run(next, user.id);
    }
    return null;
  }

  db.prepare("UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = ? WHERE id = ?").run(new Date().toISOString(), user.id);
  return toAuthUser(user);
}

// 会话回查：用户存在、启用、session_version 一致，才返回真实账号。
export function getSessionUser(
  db: Database.Database,
  userId: number,
  sessionVersion: number,
): AuthUser | null {
  const user = db
    .prepare(
      "SELECT id, username, display_name, role, company_id, is_active, must_change_password, session_version FROM users WHERE id = ?",
    )
    .get(userId) as
    | (Omit<UserRow, "password_hash" | "failed_login_count" | "locked_until"> & { password_hash: undefined })
    | undefined;
  if (!user) return null;
  if (user.is_active !== 1) return null;
  if (user.session_version !== sessionVersion) return null;
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    company_id: user.company_id,
    must_change_password: user.must_change_password,
    session_version: user.session_version,
  };
}

// 新密码规则校验，返回错误文案或 null。
export function validateNewPassword(newPassword: string, username: string): string | null {
  if (newPassword.length < 6) return "新密码不能少于 6 位";
  if (newPassword === DEFAULT_PASSWORD) return "不能继续使用默认密码 123456";
  if (newPassword === username) return "新密码不能与登录账号相同";
  return null;
}

// 修改密码：校验 → 更新哈希、清 must_change_password、session_version +1（使旧会话失效）。
export function changePassword(
  db: Database.Database,
  userId: number,
  newPassword: string,
  confirmPassword: string,
): { ok: boolean; message?: string } {
  if (newPassword !== confirmPassword) {
    return { ok: false, message: "两次输入的密码不一致" };
  }
  const user = db.prepare("SELECT id, username FROM users WHERE id = ?").get(userId) as { id: number; username: string } | undefined;
  if (!user) return { ok: false, message: "账号不存在" };
  const error = validateNewPassword(newPassword, user.username);
  if (error) return { ok: false, message: error };
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0, session_version = session_version + 1 WHERE id = ?").run(hashPassword(newPassword), userId);
  return { ok: true };
}
