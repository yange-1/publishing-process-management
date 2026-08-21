import Link from "next/link";
import { requireCurrentUser } from "@/lib/session";
import { openDatabase } from "@/lib/db";
import { listWarehouse } from "@/lib/dashboard-service";
import UserBar from "@/app/components/UserBar";
import DashboardTaskRow from "@/components/DashboardTaskRow";

export default async function WarehousePage() {
  // 开放查看：所有已登录、已启用、已完成首次改密的账号均可查看完整仓库。
  const user = await requireCurrentUser();
  const now = new Date();

  const db = openDatabase();
  let warehouse;
  try {
    warehouse = listWarehouse(db);
  } finally {
    db.close();
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-6">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">书稿仓库</h1>
          <Link
            href="/"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            返回首页
          </Link>
        </div>
        <UserBar name={user.display_name} role={user.role} />
      </header>

      {warehouse.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-12 text-center text-sm text-gray-400">
          当前没有待确认收稿或待开始的任务
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          {warehouse.map((task) => (
            <DashboardTaskRow key={task.id} task={task} now={now} />
          ))}
        </ul>
      )}
    </main>
  );
}
