import Link from "next/link";
import { requireRole } from "@/lib/session";
import { openDatabase } from "@/lib/db";
import { listUsers } from "@/lib/user-admin-service";
import UserBar from "@/app/components/UserBar";
import UserAdminPanel from "./UserAdminPanel";

export default async function AdminUsersPage() {
  // 仅已登录、已启用、已完成首次改密的 INTERNAL_ADMIN 可进入；
  // 未登录跳登录页，未改密跳改密页，普通角色跳回首页。
  const user = await requireRole("INTERNAL_ADMIN");

  const db = openDatabase();
  let users;
  try {
    users = listUsers(db, user.id);
  } finally {
    db.close();
  }

  const adminCompanyName = users.find((u) => u.id === user.id)?.company_name ?? "";

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-6">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">账号管理</h1>
          <Link
            href="/"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            返回首页
          </Link>
        </div>
        <UserBar name={user.display_name} role={user.role} />
      </header>

      <UserAdminPanel
        currentUserId={user.id}
        adminCompanyName={adminCompanyName}
        users={users}
      />
    </main>
  );
}
