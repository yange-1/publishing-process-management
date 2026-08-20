import bcrypt from "bcryptjs";

export const DEFAULT_PASSWORD = "123456";

// 创建首个 INTERNAL_ADMIN（超级管理员）。
// 幂等约束：若已存在 INTERNAL_ADMIN，则拒绝重复创建。
// 返回 { ok: true, id } 或 { ok: false, reason: "already_exists" }。
export function createInitialAdmin(db, { username, displayName, companyName }) {
  return db.transaction(() => {
    const existing = db
      .prepare("SELECT id FROM users WHERE role = 'INTERNAL_ADMIN'")
      .get();
    if (existing) {
      return { ok: false, reason: "already_exists" };
    }

    let companyId = db
      .prepare("SELECT id FROM companies WHERE type = 'INTERNAL' LIMIT 1")
      .get()?.id;
    if (!companyId) {
      const r = db
        .prepare("INSERT INTO companies(name, type) VALUES (?, 'INTERNAL')")
        .run(companyName);
      companyId = Number(r.lastInsertRowid);
    }

    const hash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
    const r = db
      .prepare(
        "INSERT INTO users(username, display_name, company_id, role, password_hash, must_change_password) VALUES (?, ?, ?, 'INTERNAL_ADMIN', ?, 1)",
      )
      .run(username, displayName, companyId, hash);

    return { ok: true, id: Number(r.lastInsertRowid) };
  })();
}
