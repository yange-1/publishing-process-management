import Link from "next/link";
import { requireCurrentUser } from "@/lib/session";
import { openDatabase } from "@/lib/db";
import {
  listWarehouse,
  listProduction,
  listCompleted,
  listOverdue,
  countActiveBooks,
} from "@/lib/dashboard-service";
import { countPendingConfirmation } from "@/lib/task-service";
import UserBar from "@/app/components/UserBar";
import DashboardTaskRow from "@/components/DashboardTaskRow";
import DashboardOverdueRow from "@/components/DashboardOverdueRow";

type StatTone = "slate" | "amber" | "blue" | "red" | "emerald";

const STAT_TONES: Record<StatTone, string> = {
  slate: "border-l-slate-500 text-slate-600",
  amber: "border-l-amber-500 text-amber-600",
  blue: "border-l-blue-500 text-blue-600",
  red: "border-l-red-500 text-red-600",
  emerald: "border-l-emerald-500 text-emerald-600",
};

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: StatTone;
}) {
  return (
    <div
      className={`rounded-lg border border-gray-200 border-l-4 ${STAT_TONES[tone]} bg-white p-3 text-center shadow-sm`}
    >
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-0.5 text-2xl font-bold">{value}</div>
    </div>
  );
}

export default async function Home() {
  const user = await requireCurrentUser();
  const now = new Date();

  const db = openDatabase();
  let warehouse;
  let production;
  let completed;
  let overdue;
  let activeBooks;
  let pendingCount;
  try {
    warehouse = listWarehouse(db);
    production = listProduction(db);
    completed = listCompleted(db);
    overdue = listOverdue(db, now);
    activeBooks = countActiveBooks(db);
    pendingCount = countPendingConfirmation(db);
  } finally {
    db.close();
  }

  const shownWarehouse = warehouse.slice(0, 20);
  const shownOverdue = overdue.slice(0, 20);

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-6">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">出版校对流程管理平台</h1>
        <div className="flex items-center gap-3">
          {user.role === "INTERNAL_ADMIN" && (
            <Link
              href="/admin/users"
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              账号管理
            </Link>
          )}
          <Link
            href="/tasks/pending-confirmation"
            className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
          >
            待确认收稿（{pendingCount}）
          </Link>
          {(user.role === "RESPONSIBLE_EDITOR" || user.role === "INTERNAL_ADMIN") && (
            <Link
              href="/tasks/new"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              发布校对任务
            </Link>
          )}
          <UserBar name={user.display_name} role={user.role} />
        </div>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="部门现有书稿" value={activeBooks} tone="slate" />
        <StatCard label="书稿仓库" value={warehouse.length} tone="amber" />
        <StatCard label="生产线" value={production.length} tone="blue" />
        <StatCard label="滞留任务" value={overdue.length} tone="red" />
        <StatCard label="已完成任务" value={completed.length} tone="emerald" />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[72fr_28fr] lg:items-start">
        <div className="space-y-8">
          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold text-gray-900">书稿仓库</h2>
              <span className="text-sm text-gray-500">共 {warehouse.length} 条</span>
            </div>
            {shownWarehouse.length === 0 ? (
              <div className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">
                当前没有待确认收稿或待开始的任务
              </div>
            ) : (
              <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                {shownWarehouse.map((task) => (
                  <DashboardTaskRow key={task.id} task={task} now={now} />
                ))}
              </ul>
            )}
            {warehouse.length > 20 && (
              <Link
                href="/tasks/warehouse"
                className="mt-3 inline-block w-full rounded-md border border-gray-300 bg-white px-4 py-2 text-center text-sm text-gray-600 hover:bg-gray-50"
              >
                查看更多
              </Link>
            )}
          </section>

          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold text-gray-900">生产线</h2>
              <span className="text-sm text-gray-500">共 {production.length} 条</span>
            </div>
            {production.length === 0 ? (
              <div className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">
                当前没有进行中的校对任务
              </div>
            ) : (
              <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                {production.map((task) => (
                  <DashboardTaskRow key={task.id} task={task} now={now} />
                ))}
              </ul>
            )}
          </section>

          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold text-gray-900">已完成</h2>
              <span className="text-sm text-gray-500">共 {completed.length} 条</span>
            </div>
            {completed.length === 0 ? (
              <div className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">
                当前没有已完成的校对任务
              </div>
            ) : (
              <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                {completed.map((task) => (
                  <DashboardTaskRow key={task.id} task={task} now={now} />
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-red-700">总控预警</h2>
            <span className="text-sm text-gray-500">共 {overdue.length} 条</span>
          </div>
          {shownOverdue.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">
              当前没有滞留任务
            </div>
          ) : (
            <ul className="space-y-2">
              {shownOverdue.map((item) => (
                <DashboardOverdueRow key={item.id} item={item} />
              ))}
            </ul>
          )}
          {overdue.length > 20 && (
            <Link
              href="/tasks/warehouse"
              className="mt-4 inline-block w-full rounded-md border border-red-200 bg-red-50 px-4 py-2 text-center text-sm text-red-600 hover:bg-red-100"
            >
              查看更多
            </Link>
          )}
        </aside>
      </div>
    </main>
  );
}
