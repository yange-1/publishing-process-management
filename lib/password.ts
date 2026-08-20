import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

// 默认初始密码（公开约定，仅用于账号创建工具，不得作为长期密码）
export const DEFAULT_PASSWORD = "123456";

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(plain, hash);
  } catch {
    return false;
  }
}
