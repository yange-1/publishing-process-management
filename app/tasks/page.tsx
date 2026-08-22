import Link from "next/link";
import { requireCurrentUser } from "@/lib/session";
import { openDatabase } from "@/lib/db";
import {
  filterTasks,
  listFilterOptions,
  parseTaskFilter,
  hasActiveFilter,
} from "@/lib/task-filter-service";
import UserBar from "@/app/components/UserBar";
import DashboardTaskRow from "@/components/DashboardTaskRow";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // 开放查看：所有已登录、已启用、已完成首次改密的账号均可查看与筛选。
  const user = await requireCurrentUser();
  const sp = await searchParams;
  const filter = parseTaskFilter(sp);
  const now = new Date();

  const db = openDatabase();
  let tasks: Awaited<ReturnType<typeof filterTasks>>;
  let options: Awaited<ReturnType<typeof listFilterOptions>>;
  try {
    options = listFilterOptions(db);
    tasks = filterTasks(db, filter);
  } finally {
    db.close();
  }

  const filtering = hasActiveFilter(filter);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-6">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">任务筛选</h1>
          <Link
            href="/"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            返回首页
          </Link>
        </div>
        <UserBar name={user.display_name} role={user.role} />
      </header>

      <form
        method="get"
        action="/tasks"
        className="mb-4 grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5"
      >
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          责任编辑
          <select
            name="editor"
            defaultValue={filter.editorId ?? ""}
            className="rounded-md border border-gray-300 px-2 py-2 text-sm text-gray-700"
          >
            <option value="">全部</option>
            {options.editors.map((e) => (
              <option key={e.id} value={e.id}>
                {e.display_name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-gray-500">
          校对负责人
          <select
            name="proofreader"
            defaultValue={filter.proofreaderId ?? ""}
            className="rounded-md border border-gray-300 px-2 py-2 text-sm text-gray-700"
          >
            <option value="">全部</option>
            {options.proofreaders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-gray-500">
          校次
          <select
            name="stage"
            defaultValue={filter.stage ?? ""}
            className="rounded-md border border-gray-300 px-2 py-2 text-sm text-gray-700"
          >
            <option value="">全部</option>
            {options.stages.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-gray-500">
          状态
          <select
            name="status"
            defaultValue={filter.status ?? ""}
            className="rounded-md border border-gray-300 px-2 py-2 text-sm text-gray-700"
          >
            <option value="">全部</option>
            {options.statuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            筛选
          </button>
          {filtering && (
            <Link
              href="/tasks"
              className="flex-1 rounded-md border border-gray-300 bg-white px-4 py-2 text-center text-sm text-gray-600 hover:bg-gray-50"
            >
              清除
            </Link>
          )}
        </div>
      </form>

      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-sm text-gray-500">
          {filtering ? "筛选结果" : "全部任务"} · 共 {tasks.length} 条
        </span>
      </div>

      {tasks.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-12 text-center text-sm text-gray-400">
          {filtering ? "没有符合条件的任务" : "当前没有任何任务"}
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          {tasks.map((task) => (
            <DashboardTaskRow
              key={task.id}
              task={task}
              now={now}
              currentUserId={user.id}
            />
          ))}
        </ul>
      )}
    </main>
  );
}
