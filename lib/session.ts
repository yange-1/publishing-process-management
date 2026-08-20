import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "./auth";
import { getSessionUser, type AuthUser } from "./auth-service";
import { openDatabase } from "./db";

export type CurrentUser = AuthUser;

// 回查数据库，取真实账号状态；session_version 不一致或停用则视为无效。
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;

  const db = openDatabase();
  try {
    return getSessionUser(db, Number(session.user.id), session.user.sessionVersion);
  } finally {
    db.close();
  }
}

export async function requireCurrentUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.must_change_password === 1) redirect("/change-password");
  return user;
}

export async function requireRole(role: string): Promise<CurrentUser> {
  const user = await requireCurrentUser();
  if (user.role !== role && user.role !== "INTERNAL_ADMIN") {
    redirect("/");
  }
  return user;
}
