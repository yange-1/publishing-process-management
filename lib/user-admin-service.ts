import type Database from "better-sqlite3";
import { hashPassword, DEFAULT_PASSWORD } from "./password.ts";

// ===== 业务错误 =====
// 为未来账号管理页面准备稳定的错误代码，不向页面泄露 SQLite 原始错误。

export type UserAdminErrorCode =
  | "NOT_AUTHENTICATED"
  | "USER_NOT_FOUND"
  | "USER_INACTIVE"
  | "MUST_CHANGE_PASSWORD"
  | "FORBIDDEN"
  | "USERNAME_TAKEN"
  | "INVALID_INPUT"
  | "INVALID_ROLE"
  | "CANNOT_MANAGE_ADMIN"
  | "CANNOT_OPERATE_SELF"
  | "TARGET_NOT_FOUND";

export class UserAdminServiceError extends Error {
  readonly code: UserAdminErrorCode;
  constructor(code: UserAdminErrorCode, message: string) {
    super(message);
    this.name = "UserAdminServiceError";
    this.code = code;
  }
}

// ===== 常量 =====

// 普通账号管理服务只允许创建这三类业务账号，不允许创建新的 INTERNAL_ADMIN。
const CREATABLE_ROLES = [
  "RESPONSIBLE_EDITOR",
  "EXTERNAL_SUPERVISOR",
  "PROOFREADER",
] as const;

type CreatableRole = (typeof CREATABLE_ROLES)[number];

const COMPANY_TYPE_BY_ROLE: Record<CreatableRole, "INTERNAL" | "EXTERNAL"> = {
  RESPONSIBLE_EDITOR: "INTERNAL",
  EXTERNAL_SUPERVISOR: "EXTERNAL",
  PROOFREADER: "EXTERNAL",
};

const OP_CREATE_USER = "CREATE_USER";
const OP_RESET_PASSWORD = "RESET_PASSWORD";
const OP_DEACTIVATE_USER = "DEACTIVATE_USER";
const OP_ACTIVATE_USER = "ACTIVATE_USER";

const MAX_USERNAME_LENGTH = 64;

// 重置密码后对外的统一提示文案。
export const RESET_PASSWORD_NOTICE =
  "密码已重置为统一初始密码123456，该用户下次登录必须修改密码。";

// ===== 内部工具 =====

interface AdminRow {
  id: number;
  role: string;
  is_active: number;
  must_change_password: number;
}

interface TargetRow {
  id: number;
  role: string;
  is_active: number;
  must_change_password: number;
  session_version: number;
  failed_login_count: number;
  locked_until: string | null;
}

function now(): string {
  return new Date().toISOString();
}

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string };
  return typeof err?.code === "string" && err.code.startsWith("SQLITE_CONSTRAINT");
}

function isCreatableRole(role: string): role is CreatableRole {
  return (CREATABLE_ROLES as readonly string[]).includes(role);
}

// 登录账号不得包含空白符或控制字符（含 DEL 0x7F）。
function containsWhitespaceOrControl(s: string): boolean {
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (ch.trim() === "" || code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

// 回查数据库确认实际角色，不信任调用方传入的角色、姓名或公司。
// 只有「已登录、已启用、已完成首次改密」的 INTERNAL_ADMIN 才能执行账号管理。
function requireAdmin(
  db: Database.Database,
  currentUserId: number | null | undefined,
): AdminRow {
  if (currentUserId == null) {
    throw new UserAdminServiceError("NOT_AUTHENTICATED", "未登录");
  }
  const user = db
    .prepare(
      "SELECT id, role, is_active, must_change_password FROM users WHERE id = ?",
    )
    .get(currentUserId) as AdminRow | undefined;
  if (!user) throw new UserAdminServiceError("USER_NOT_FOUND", "账号不存在");
  if (user.is_active !== 1)
    throw new UserAdminServiceError("USER_INACTIVE", "账号已停用");
  if (user.role !== "INTERNAL_ADMIN")
    throw new UserAdminServiceError("FORBIDDEN", "无管理员权限");
  if (user.must_change_password !== 0)
    throw new UserAdminServiceError("MUST_CHANGE_PASSWORD", "请先完成首次改密");
  return user;
}

function getTarget(db: Database.Database, targetUserId: number): TargetRow {
  const user = db
    .prepare(
      "SELECT id, role, is_active, must_change_password, session_version, failed_login_count, locked_until FROM users WHERE id = ?",
    )
    .get(targetUserId) as TargetRow | undefined;
  if (!user) throw new UserAdminServiceError("TARGET_NOT_FOUND", "目标用户不存在");
  return user;
}

function insertAudit(
  db: Database.Database,
  operatorId: number,
  operationType: string,
  targetId: number,
  reason: string,
  beforeValue: string | null,
  afterValue: string | null,
): void {
  db.prepare(
    "INSERT INTO audit_log(operator_id, operation_type, target_type, target_id, reason, before_value, after_value, occurred_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run(
    operatorId,
    operationType,
    "user",
    String(targetId),
    reason,
    beforeValue,
    afterValue,
    now(),
  );
}

// ===== 对外类型 =====

export interface UserListItem {
  id: number;
  username: string;
  display_name: string;
  role: string;
  company_name: string | null;
  is_active: boolean;
  must_change_password: boolean;
  is_locked: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface CreateUserParams {
  username: string;
  displayName: string;
  role: string;
  companyName: string;
}

// ===== 1. 查看账号列表 =====

export function listUsers(
  db: Database.Database,
  currentUserId: number | null | undefined,
): UserListItem[] {
  requireAdmin(db, currentUserId);

  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.role, u.is_active,
              u.must_change_password, u.locked_until, u.last_login_at, u.created_at,
              c.name AS company_name
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       ORDER BY
         CASE u.role
           WHEN 'INTERNAL_ADMIN' THEN 0
           WHEN 'RESPONSIBLE_EDITOR' THEN 1
           WHEN 'EXTERNAL_SUPERVISOR' THEN 2
           WHEN 'PROOFREADER' THEN 3
           ELSE 4
         END,
         c.name, u.display_name, u.id`,
    )
    .all() as Array<{
      id: number;
      username: string;
      display_name: string;
      role: string;
      is_active: number;
      must_change_password: number;
      locked_until: string | null;
      last_login_at: string | null;
      created_at: string;
      company_name: string | null;
    }>;

  const nowMs = Date.now();
  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    display_name: r.display_name,
    role: r.role,
    company_name: r.company_name,
    is_active: r.is_active === 1,
    must_change_password: r.must_change_password === 1,
    is_locked: r.locked_until != null && new Date(r.locked_until).getTime() > nowMs,
    last_login_at: r.last_login_at,
    created_at: r.created_at,
  }));
}

// ===== 2. 创建普通业务账号 =====

export function createUser(
  db: Database.Database,
  currentUserId: number | null | undefined,
  params: CreateUserParams,
): number {
  const admin = requireAdmin(db, currentUserId);

  const username = (params.username ?? "").trim();
  const displayName = (params.displayName ?? "").trim();
  const companyName = (params.companyName ?? "").trim();
  const role = params.role;

  if (!username) throw new UserAdminServiceError("INVALID_INPUT", "登录账号不能为空");
  if (username.length > MAX_USERNAME_LENGTH)
    throw new UserAdminServiceError(
      "INVALID_INPUT",
      `登录账号长度不能超过 ${MAX_USERNAME_LENGTH} 字符`,
    );
  if (containsWhitespaceOrControl(username))
    throw new UserAdminServiceError("INVALID_INPUT", "登录账号不能包含空白符或控制字符");
  if (!displayName)
    throw new UserAdminServiceError("INVALID_INPUT", "显示姓名不能为空");
  if (!companyName)
    throw new UserAdminServiceError("INVALID_INPUT", "公司或部门名称不能为空");
  if (!isCreatableRole(role))
    throw new UserAdminServiceError("INVALID_ROLE", "无效角色");

  const companyType = COMPANY_TYPE_BY_ROLE[role];
  const hash = hashPassword(DEFAULT_PASSWORD);

  try {
    return db.transaction(() => {
      // 相同名称 + 相同类型的公司复用，避免重复创建。
      let company = db
        .prepare("SELECT id FROM companies WHERE name = ? AND type = ?")
        .get(companyName, companyType) as { id: number } | undefined;
      if (!company) {
        const r = db
          .prepare("INSERT INTO companies(name, type) VALUES (?, ?)")
          .run(companyName, companyType);
        company = { id: Number(r.lastInsertRowid) };
      }

      const result = db
        .prepare(
          "INSERT INTO users(username, display_name, company_id, role, password_hash, must_change_password) VALUES (?,?,?,?,?,1)",
        )
        .run(username, displayName, company.id, role, hash);
      const userId = Number(result.lastInsertRowid);

      insertAudit(
        db,
        admin.id,
        OP_CREATE_USER,
        userId,
        "管理员创建账号",
        null,
        JSON.stringify({ username, display_name: displayName, role, company_name: companyName }),
      );
      return userId;
    })();
  } catch (e) {
    if (isUniqueViolation(e))
      throw new UserAdminServiceError("USERNAME_TAKEN", "登录账号已存在");
    throw e;
  }
}

// ===== 3. 重置密码 =====

export function resetUserPassword(
  db: Database.Database,
  currentUserId: number | null | undefined,
  targetUserId: number,
): void {
  const admin = requireAdmin(db, currentUserId);
  if (targetUserId === admin.id)
    throw new UserAdminServiceError("CANNOT_OPERATE_SELF", "不能重置自己的密码");

  const target = getTarget(db, targetUserId);
  if (target.role === "INTERNAL_ADMIN")
    throw new UserAdminServiceError("CANNOT_MANAGE_ADMIN", "不能重置其他管理员");

  const hash = hashPassword(DEFAULT_PASSWORD);

  db.transaction(() => {
    db.prepare(
      "UPDATE users SET password_hash = ?, must_change_password = 1, failed_login_count = 0, locked_until = NULL, session_version = session_version + 1 WHERE id = ?",
    ).run(hash, targetUserId);

    insertAudit(
      db,
      admin.id,
      OP_RESET_PASSWORD,
      targetUserId,
      "管理员重置密码",
      JSON.stringify({ must_change_password: target.must_change_password }),
      JSON.stringify({ must_change_password: 1 }),
    );
  })();
}

// ===== 4. 停用账号 =====

export function deactivateUser(
  db: Database.Database,
  currentUserId: number | null | undefined,
  targetUserId: number,
): void {
  const admin = requireAdmin(db, currentUserId);
  if (targetUserId === admin.id)
    throw new UserAdminServiceError("CANNOT_OPERATE_SELF", "不能停用自己");

  const target = getTarget(db, targetUserId);
  if (target.role === "INTERNAL_ADMIN")
    throw new UserAdminServiceError("CANNOT_MANAGE_ADMIN", "不能停用其他管理员");

  if (target.is_active === 0) return; // 幂等：已停用不重复变更

  db.transaction(() => {
    db.prepare(
      "UPDATE users SET is_active = 0, session_version = session_version + 1 WHERE id = ?",
    ).run(targetUserId);

    insertAudit(
      db,
      admin.id,
      OP_DEACTIVATE_USER,
      targetUserId,
      "管理员停用账号",
      JSON.stringify({ is_active: 1 }),
      JSON.stringify({ is_active: 0 }),
    );
  })();
}

// ===== 5. 重新启用账号 =====

export function activateUser(
  db: Database.Database,
  currentUserId: number | null | undefined,
  targetUserId: number,
): void {
  const admin = requireAdmin(db, currentUserId);

  const target = getTarget(db, targetUserId);
  // 幂等：已启用且无锁定残留时不产生变更。
  if (target.is_active === 1 && target.failed_login_count === 0 && target.locked_until == null) {
    return;
  }

  db.transaction(() => {
    db.prepare(
      "UPDATE users SET is_active = 1, failed_login_count = 0, locked_until = NULL WHERE id = ?",
    ).run(targetUserId);

    insertAudit(
      db,
      admin.id,
      OP_ACTIVATE_USER,
      targetUserId,
      "管理员启用账号",
      JSON.stringify({ is_active: target.is_active }),
      JSON.stringify({ is_active: 1 }),
    );
  })();
}
