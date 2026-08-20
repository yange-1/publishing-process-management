import OverdueRow from "@/components/OverdueRow";
import ProductionRow from "@/components/ProductionRow";
import WarehouseRow from "@/components/WarehouseRow";
import {
  MOCK_PROJECTS,
  isProduction,
  isWarehouse,
  overdueInfo,
  sortOverdue,
  sortProjects,
} from "@/components/projects";
import { requireCurrentUser } from "@/lib/session";
import UserBar from "@/app/components/UserBar";

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

const NAV_ITEMS = ["总览", "书稿仓库", "生产线", "已完成"] as const;

export default async function Home() {
  const user = await requireCurrentUser();
  const today = new Date();

  const warehouse = sortProjects(MOCK_PROJECTS.filter(isWarehouse));
  const production = sortProjects(MOCK_PROJECTS.filter(isProduction));
  const completed = MOCK_PROJECTS.filter((p) => p.status === "已完成");

  const overdueAll = sortOverdue(
    MOCK_PROJECTS.filter(
      (p) => p.status !== "已完成" && overdueInfo(p, today).isOverdue,
    ),
    today,
  );
  const shownOverdue = overdueAll.slice(0, 20);

  const totalActive = warehouse.length + production.length;

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-6">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">
          出版校对流程管理平台
        </h1>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            发布校对任务
          </button>
          <UserBar name={user.display_name} role={user.role} />
        </div>
      </header>

      <nav className="mb-4 flex flex-wrap gap-2">
        {NAV_ITEMS.map((item) => (
          <button
            key={item}
            type="button"
            className={
              item === "总览"
                ? "rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white"
                : "rounded-md border border-gray-300 bg-white px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            }
          >
            {item}
          </button>
        ))}
      </nav>

      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <input
            type="text"
            aria-label="搜索书稿"
            placeholder="请输入书名或责任编辑"
            className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400"
          />
          <button
            type="button"
            className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            搜索
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          编辑可查询书稿是否进入生产线及校对历史
        </p>
      </section>

      <section className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="部门现存书稿" value={totalActive} tone="slate" />
        <StatCard label="书稿仓库" value={warehouse.length} tone="amber" />
        <StatCard label="生产线" value={production.length} tone="blue" />
        <StatCard label="滞留任务" value={overdueAll.length} tone="red" />
        <StatCard label="已完成任务" value={completed.length} tone="emerald" />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[72fr_28fr] lg:items-start">
        <div className="space-y-8">
          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold text-gray-900">书稿仓库</h2>
              <span className="text-sm text-gray-500">
                共 {warehouse.length} 条
              </span>
            </div>
            <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg bg-white shadow-sm">
              {warehouse.map((project) => (
                <WarehouseRow key={project.id} project={project} today={today} />
              ))}
            </ul>
            <button
              type="button"
              className="mt-3 w-full rounded-md border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              进入书稿仓库查看更多
            </button>
          </section>

          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold text-gray-900">生产线</h2>
              <span className="text-sm text-gray-500">
                共 {production.length} 条
              </span>
            </div>
            <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg bg-white shadow-sm">
              {production.map((project) => (
                <ProductionRow
                  key={project.id}
                  project={project}
                  today={today}
                />
              ))}
            </ul>
            <button
              type="button"
              className="mt-3 w-full rounded-md border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              查看完整生产线
            </button>
          </section>
        </div>

        <aside>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-red-700">总控预警</h2>
            <span className="text-sm text-gray-500">
              共 {overdueAll.length} 条
            </span>
          </div>
          <ul className="space-y-2">
            {shownOverdue.map((project) => (
              <OverdueRow
                key={project.id}
                project={project}
                today={today}
                kind={isWarehouse(project) ? "warehouse" : "production"}
              />
            ))}
          </ul>
          <button
            type="button"
            className="mt-4 w-full rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 hover:bg-red-100"
          >
            查看全部滞留任务
          </button>
        </aside>
      </div>
    </main>
  );
}
