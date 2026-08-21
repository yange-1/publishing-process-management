import Link from "next/link";
import { requireCurrentUser } from "@/lib/session";
import { openDatabase } from "@/lib/db";
import { listWarehouse } from "@/lib/dashboard-service";
import { listActiveProofreaders, type ProofreaderOption } from "@/lib/task-service";
import UserBar from "@/app/components/UserBar";
import DashboardTaskRow from "@/components/DashboardTaskRow";
import StartActions from "@/components/StartActions";

export default async function WarehousePage() {
  // 开放查看：所有已登录、已启用、已完成首次改密的账号均可查看完整仓库。
  const user = await requireCurrentUser();
  const now = new Date();

  const db = openDatabase();
  let warehouse;
  const proofreadersByCompany = new Map<number, ProofreaderOption[]>();
  try {
    warehouse = listWarehouse(db);
    if (user.role === "INTERNAL_ADMIN") {
      for (const task of warehouse) {
        if (
          task.status === "READY_TO_START" &&
          task.companyId != null &&
          !proofreadersByCompany.has(task.companyId)
        ) {
          proofreadersByCompany.set(task.companyId, listActiveProofreaders(db, task.companyId));
        }
      }
    }
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
          {warehouse.map((task) => {
            const isMine =
              user.role === "PROOFREADER" && task.companyId === user.company_id;
            const isAdmin = user.role === "INTERNAL_ADMIN";
            const canAct = (isMine || isAdmin) && task.status === "READY_TO_START";
            const action = canAct ? (
              <StartActions
                taskId={task.id}
                taskCompanyId={task.companyId}
                currentRole={user.role}
                currentCompanyId={user.company_id ?? null}
                proofreaders={
                  isAdmin && task.companyId != null
                    ? proofreadersByCompany.get(task.companyId) ?? []
                    : []
                }
              />
            ) : undefined;
            return (
              <DashboardTaskRow
                key={task.id}
                task={task}
                now={now}
                currentUserId={user.id}
                action={action}
              />
            );
          })}
        </ul>
      )}
    </main>
  );
}
