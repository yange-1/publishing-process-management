import Link from "next/link";
import { requireCurrentUser } from "@/lib/session";
import { openDatabase } from "@/lib/db";
import {
  listWarehouse,
  listProduction,
  listCompleted,
  listOverdue,
  countActiveBooks,
  listProductionByEditor,
  listCompletedByEditor,
  countActiveBooksByEditor,
  countWarehouseByCompany,
  listInTransit,
  listInTransitByEditor,
  listDeliveredUnconfirmedByEditor,
  type DashboardTask,
  type DeliveredTask,
} from "@/lib/dashboard-service";
import {
  countPendingConfirmation,
  listPendingConfirmation,
  listActiveProofreaders,
  listActiveExternalCompanies,
  type ProofreaderOption,
} from "@/lib/task-service";
import { listMyTodos } from "@/lib/todo-service";
import { recentDeliveryCutoffMs } from "@/lib/delivery-service";
import UserBar from "@/app/components/UserBar";
import DashboardTaskRow from "@/components/DashboardTaskRow";
import DashboardOverdueRow from "@/components/DashboardOverdueRow";
import StartActions from "@/components/StartActions";
import FinishActions from "@/components/FinishActions";
import CancelActions from "@/components/CancelActions";
import SearchBox from "@/components/SearchBox";
import SupervisorPendingList from "@/components/SupervisorPendingList";
import SupervisorInTransitList from "@/components/SupervisorInTransitList";
import EditorMealBoard from "@/components/EditorMealBoard";
import EditorOrderCard from "@/components/EditorOrderCard";
import EditorQueueCard from "@/components/EditorQueueCard";

// 统一统计卡：白色卡片 + 顶部细色条 + 小圆点图标 + 强调色数字（黄橙红主导）。
type StatTone = "purple" | "yellow" | "orange" | "red" | "rose" | "green";

const STAT_TONES: Record<StatTone, { bar: string; number: string }> = {
  purple: { bar: "bg-violet-500", number: "text-violet-600" },
  yellow: { bar: "bg-[#FFD43B]", number: "text-amber-600" },
  orange: { bar: "bg-[#FF7A00]", number: "text-orange-600" },
  red: { bar: "bg-[#FF5A1F]", number: "text-[#FF5A1F]" },
  rose: { bar: "bg-rose-400", number: "text-rose-500" },
  green: { bar: "bg-green-500", number: "text-green-600" },
};

function StatCard({
  label,
  value,
  tone,
  href,
  unit,
}: {
  label: string;
  value: number;
  tone: StatTone;
  href?: string;
  unit?: string;
}) {
  const t = STAT_TONES[tone];
  const content = (
    <>
      <div className={`h-1 w-8 rounded-full ${t.bar}`} />
      <div className="mt-2 flex items-center gap-1.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${t.bar}`} />
        <span className="text-xs text-[#667085]">{label}</span>
      </div>
      <div className={`mt-1 text-2xl font-bold ${t.number}`}>
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-[#667085]">{unit}</span>}
      </div>
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="block rounded-lg border border-[#E6E8EC] bg-white p-3 shadow-sm transition hover:shadow-md"
      >
        {content}
      </Link>
    );
  }
  return (
    <div className="rounded-lg border border-[#E6E8EC] bg-white p-3 shadow-sm">{content}</div>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCurrentUser();
  const sp = await searchParams;
  const companyParam = typeof sp.company === "string" ? sp.company : "";
  const companyFilter =
    companyParam && Number.parseInt(companyParam, 10) > 0
      ? Number.parseInt(companyParam, 10)
      : null;
  const now = new Date();
  const isEditor = user.role === "RESPONSIBLE_EDITOR";

  const db = openDatabase();
  let warehouse;
  let production;
  let completed;
  let overdue;
  let activeBooks;
  let pendingCount;
  let myTodoCount;
  let supervisorPending;
  let myProduction: DashboardTask[] = [];
  let myCompleted: DashboardTask[] = [];
  let myActiveBooks = 0;
  let myPendingCount = 0;
  let externalCompanies;
  let warehouseByCompany;
  let inTransit: DashboardTask[] = [];
  let inTransitByEditor: DashboardTask[] = [];
  let deliveredUnconfirmed: DeliveredTask[] = [];
  const proofreadersByCompany = new Map<number, ProofreaderOption[]>();
  try {
    warehouse = listWarehouse(db);
    production = listProduction(db);
    completed = listCompleted(db);
    overdue = listOverdue(db, now);
    activeBooks = countActiveBooks(db);
    pendingCount = countPendingConfirmation(db);
    myTodoCount = listMyTodos(db, { id: user.id, role: user.role, companyId: user.company_id ?? null }).activeCount;
    supervisorPending =
      user.role === "EXTERNAL_SUPERVISOR" && user.company_id != null
        ? listPendingConfirmation(db, { companyId: user.company_id })
        : [];
    externalCompanies = listActiveExternalCompanies(db);
    warehouseByCompany = countWarehouseByCompany(db);
    if (user.role === "EXTERNAL_SUPERVISOR" && user.company_id != null) {
      inTransit = listInTransit(db, user.company_id);
    } else if (user.role === "INTERNAL_ADMIN") {
      inTransit = listInTransit(db, null);
    }
    if (isEditor) {
      myProduction = listProductionByEditor(db, user.id);
      myCompleted = listCompletedByEditor(db, user.id);
      myActiveBooks = countActiveBooksByEditor(db, user.id);
      myPendingCount = countPendingConfirmation(db, { editorId: user.id });
      inTransitByEditor = listInTransitByEditor(db, user.id);
      deliveredUnconfirmed = listDeliveredUnconfirmedByEditor(
        db,
        user.id,
        new Date(recentDeliveryCutoffMs(now)).toISOString(),
      );
    }
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

  const warehouseForDisplay =
    isEditor && companyFilter != null
      ? warehouse.filter((t) => t.companyId === companyFilter)
      : warehouse;
  const shownWarehouse = warehouseForDisplay.slice(0, 20);
  const shownOverdue = overdue.slice(0, 20);
  const shownPending = supervisorPending.slice(0, 20);
  const productionList = isEditor ? myProduction : production;
  const completedList = isEditor ? myCompleted : completed;
  const inTransitIds = new Set(inTransitByEditor.map((t) => t.id));
  const deliveredIds = new Set(deliveredUnconfirmed.map((t) => t.id));
  // 责任编辑订单进度（已下单1 → 已接单2 → 待制作3 → “备餐”中4 → 配送中5 → 待“收货”6 → 已完成7）。
  // 仅根据现有 tasks.status 与配送事实映射，不新增后台状态。
  const orderStepFor = (task: DashboardTask): number => {
    switch (task.status) {
      case "PENDING_CONFIRMATION":
        return 1;
      case "READY_TO_START":
        return 3;
      case "IN_PROGRESS":
        return 4;
      case "COMPLETED":
        if (deliveredIds.has(task.id)) return 6;
        if (inTransitIds.has(task.id)) return 5;
        return 7;
      default:
        return 1;
    }
  };

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="rounded-xl bg-[#FFD43B] px-4 py-2">
          <h1 className="text-2xl font-bold text-gray-900">校了么</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {user.role === "INTERNAL_ADMIN" && (
            <Link
              href="/admin/users"
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              账号管理
            </Link>
          )}
          {user.role !== "PROOFREADER" && user.role !== "EXTERNAL_SUPERVISOR" && (
            <Link
              href="/tasks/pending-confirmation"
              className="rounded-md border border-[#FFD43B] bg-[#FFF4C2] px-4 py-2 text-sm font-medium text-[#172033] hover:bg-[#FFD43B]"
            >
              {isEditor ? "我的待确认" : "您有新的订单！"}（{isEditor ? myPendingCount : pendingCount}）
            </Link>
          )}
          {user.role !== "EXTERNAL_SUPERVISOR" && (
            <Link
              href="/tasks/my-todos"
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              我的待办（{myTodoCount}）
            </Link>
          )}
          <Link
            href="/tasks"
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            任务筛选
          </Link>
          {(user.role === "INTERNAL_ADMIN" || user.role === "EXTERNAL_SUPERVISOR") && (
            <Link
              href="/reports"
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              统计报表
            </Link>
          )}
          {(user.role === "RESPONSIBLE_EDITOR" || user.role === "INTERNAL_ADMIN") && (
            <Link
              href="/tasks/new"
              className="rounded-md bg-[#FF5A1F] px-4 py-2 text-sm font-medium text-white hover:bg-[#E94710]"
            >
              发布校对任务
            </Link>
          )}
          <UserBar name={user.display_name} role={user.role} />
        </div>
      </header>

      <section className="mb-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <SearchBox />
        <p className="mt-2 text-xs text-gray-500">可搜索书名或责任编辑姓名，查看书稿校对历史</p>
      </section>

      <section className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {isEditor ? (
          <>
            <StatCard label="我的现有书稿" value={myActiveBooks} tone="purple" />
            <StatCard label="我的待确认" value={myPendingCount} tone="yellow" />
            <StatCard label="前方还有" value={warehouseForDisplay.length} tone="orange" unit="份待制作" />
            <StatCard label="“备餐”中，请耐心等待～" value={myProduction.length} tone="red" />
            <StatCard label="我的已完成" value={myCompleted.length} tone="rose" />
          </>
        ) : (
          <>
            <StatCard label="部门现有书稿" value={activeBooks} tone="purple" />
            <StatCard label="书稿仓库" value={warehouse.length} tone="yellow" />
            <StatCard label="生产线" value={production.length} tone="orange" />
            <StatCard label="滞留任务" value={overdue.length} tone="red" />
            <StatCard
              label="已完成任务"
              value={completed.length}
              tone="rose"
              href={user.role === "EXTERNAL_SUPERVISOR" ? "/tasks/completed" : undefined}
            />
          </>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="space-y-8">
          {user.role === "EXTERNAL_SUPERVISOR" && (
            <section className="rounded-xl bg-[#FFF4C2]/60 p-3">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-lg font-semibold text-gray-900">您有新的订单！</h2>
                <span className="text-sm text-gray-500">共 {supervisorPending.length} 条</span>
              </div>
              {shownPending.length === 0 ? (
                <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-center text-sm text-gray-400">
                  当前没有新的订单
                </div>
              ) : (
                <SupervisorPendingList items={shownPending} />
              )}
              {supervisorPending.length > 20 && (
                <Link
                  href="/tasks/pending-confirmation"
                  className="mt-3 inline-block w-full rounded-md border border-gray-300 bg-white px-4 py-2 text-center text-sm text-gray-600 hover:bg-gray-50"
                >
                  查看全部新的订单
                </Link>
              )}
            </section>
          )}

          {(user.role === "EXTERNAL_SUPERVISOR" || user.role === "INTERNAL_ADMIN") && (
            <section className="rounded-xl bg-[#FFF4C2]/60 p-3">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-lg font-semibold text-gray-900">运送中</h2>
                <span className="text-sm text-gray-500">共 {inTransit.length} 条</span>
              </div>
              {inTransit.length === 0 ? (
                <div className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">
                  当前没有待送达的稿件
                </div>
              ) : (
                <SupervisorInTransitList items={inTransit} currentRole={user.role} />
              )}
            </section>
          )}

          {isEditor ? (
            <section>
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-lg font-semibold text-gray-900">前方还有 {warehouseForDisplay.length} 份待制作</h2>
                <span className="text-sm text-gray-500">共 {warehouseForDisplay.length} 条</span>
              </div>
              <div className="mb-2 h-1 w-16 rounded-full bg-[#FFD43B]" />
              <div className="mb-2 flex flex-wrap gap-2 text-xs text-gray-600">
                {warehouseByCompany.map((c) => (
                  <span key={c.companyId ?? 0} className="rounded bg-gray-100 px-2 py-1">
                    {c.companyName ?? "未指定外校公司"}：{c.count}
                  </span>
                ))}
              </div>
              <form method="get" action="/" className="mb-3 flex items-center gap-2">
                <select
                  name="company"
                  defaultValue={companyFilter ?? ""}
                  className="rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-700 focus:border-[#FF7A00] focus:outline-none focus:ring-1 focus:ring-[#FF7A00]"
                >
                  <option value="">全部外校公司</option>
                  {externalCompanies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-md bg-[#FF5A1F] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#E94710]"
                >
                  筛选
                </button>
                {companyFilter != null && (
                  <Link
                    href="/"
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                  >
                    清除
                  </Link>
                )}
              </form>
              {shownWarehouse.length === 0 ? (
                <div className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">
                  当前没有待开始的任务
                </div>
              ) : (
                <ul className="space-y-2">
                  {shownWarehouse.map((task) => (
                    <EditorQueueCard
                      key={task.id}
                      task={task}
                      now={now}
                      action={
                        <CancelActions
                          task={task}
                          currentRole={user.role}
                          currentUserId={user.id}
                        />
                      }
                    />
                  ))}
                </ul>
              )}
              {warehouseForDisplay.length > 20 && (
                <Link
                  href={`/tasks/warehouse${companyFilter != null ? `?company=${companyFilter}` : ""}`}
                  className="mt-3 inline-block w-full rounded-md border border-gray-300 bg-white px-4 py-2 text-center text-sm text-gray-600 hover:bg-gray-50"
                >
                  查看更多
                </Link>
              )}
            </section>
          ) : (
            <section>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-lg font-semibold text-gray-900">书稿仓库</h2>
                <span className="text-sm text-gray-500">共 {warehouse.length} 条</span>
              </div>
              {shownWarehouse.length === 0 ? (
                <div className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">
                  当前没有待开始的任务
                </div>
              ) : (
                <ul className="space-y-2">
                  {shownWarehouse.map((task) => {
                    const isMine =
                      user.role === "PROOFREADER" && task.companyId === user.company_id;
                    const isAdmin = user.role === "INTERNAL_ADMIN";
                    const canStart = (isMine || isAdmin) && task.status === "READY_TO_START";
                    const canCancel =
                      (isAdmin ||
                        (user.role === "RESPONSIBLE_EDITOR" && task.editorId === user.id)) &&
                      task.status === "READY_TO_START";
                    const action =
                      canStart || canCancel ? (
                        <div className="flex flex-col items-end gap-2">
                          {canStart && (
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
                          )}
                          {canCancel && (
                            <CancelActions
                              task={task}
                              currentRole={user.role}
                              currentUserId={user.id}
                            />
                          )}
                        </div>
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
              {warehouse.length > 20 && (
                <Link
                  href="/tasks/warehouse"
                  className="mt-3 inline-block w-full rounded-md border border-gray-300 bg-white px-4 py-2 text-center text-sm text-gray-600 hover:bg-gray-50"
                >
                  查看更多
                </Link>
              )}
            </section>
          )}

          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold text-gray-900">{isEditor ? "“备餐”中，请耐心等待～" : "生产线"}</h2>
              <span className="text-sm text-gray-500">共 {productionList.length} 条</span>
            </div>
            {productionList.length === 0 ? (
              <div className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">
                当前没有进行中的校对任务
              </div>
            ) : (
              <ul className="space-y-2">
                {productionList.map((task) => {
                  if (isEditor) {
                    return (
                      <EditorOrderCard key={task.id} task={task} now={now} step={orderStepFor(task)} />
                    );
                  }
                  const isMine =
                    user.role === "PROOFREADER" && task.proofreaderId === user.id;
                  const isAdmin = user.role === "INTERNAL_ADMIN";
                  const action =
                    isMine || isAdmin ? (
                      <FinishActions
                        taskId={task.id}
                        taskProofreaderId={task.proofreaderId}
                        currentRole={user.role}
                        currentUserId={user.id}
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
          </section>

          {user.role !== "EXTERNAL_SUPERVISOR" && (
            <section>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-lg font-semibold text-gray-900">{isEditor ? "我的已完成" : "已完成"}</h2>
                <span className="text-sm text-gray-500">共 {completedList.length} 条</span>
              </div>
              {completedList.length === 0 ? (
                <div className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">
                  当前没有已完成的校对任务
                </div>
              ) : (
                <ul className="space-y-2">
                  {completedList.map((task) =>
                    isEditor ? (
                      <EditorOrderCard key={task.id} task={task} now={now} step={orderStepFor(task)} />
                    ) : (
                      <DashboardTaskRow key={task.id} task={task} now={now} />
                    ),
                  )}
                </ul>
              )}
            </section>
          )}
        </div>

        {isEditor ? (
          <aside className="rounded-xl border border-[#E6E8EC] bg-[#FFF4C2]/60 p-4">
            <div className="mb-3 flex items-center justify-between rounded-lg bg-[#FFD43B] px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-[#FF5A1F]" />
                <h2 className="text-base font-bold text-[#172033]">已“出餐”</h2>
              </div>
              <span className="text-xs font-medium text-[#172033]/70">
                共 {deliveredUnconfirmed.length + inTransitByEditor.length} 条
              </span>
            </div>
            {deliveredUnconfirmed.length + inTransitByEditor.length === 0 ? (
              <div className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">
                当前没有配送中的稿件
              </div>
            ) : (
              <EditorMealBoard delivered={deliveredUnconfirmed} inTransit={inTransitByEditor} />
            )}
          </aside>
        ) : (
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
        )}
      </div>
    </main>
  );
}
