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
  type DashboardTask,
} from "@/lib/dashboard-service";
import {
  countPendingConfirmation,
  listPendingConfirmation,
  listActiveProofreaders,
  listActiveExternalCompanies,
  type ProofreaderOption,
} from "@/lib/task-service";
import { listMyTodos } from "@/lib/todo-service";
import UserBar from "@/app/components/UserBar";
import DashboardTaskRow from "@/components/DashboardTaskRow";
import DashboardOverdueRow from "@/components/DashboardOverdueRow";
import StartActions from "@/components/StartActions";
import FinishActions from "@/components/FinishActions";
import CancelActions from "@/components/CancelActions";
import SearchBox from "@/components/SearchBox";
import SupervisorPendingList from "@/components/SupervisorPendingList";

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
  href,
}: {
  label: string;
  value: number;
  tone: StatTone;
  href?: string;
}) {
  const cls = `rounded-lg border border-gray-200 border-l-4 ${STAT_TONES[tone]} bg-white p-3 text-center shadow-sm`;
  const content = (
    <>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-0.5 text-2xl font-bold">{value}</div>
    </>
  );
  if (href) {
    return (
      <Link href={href} className={`${cls} block transition hover:bg-gray-50`}>
        {content}
      </Link>
    );
  }
  return <div className={cls}>{content}</div>;
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
      user.role === "EXTERNAL_SUPERVISOR"
        ? listPendingConfirmation(db).filter((t) => t.companyId === user.company_id)
        : [];
    externalCompanies = listActiveExternalCompanies(db);
    warehouseByCompany = countWarehouseByCompany(db);
    if (isEditor) {
      myProduction = listProductionByEditor(db, user.id);
      myCompleted = listCompletedByEditor(db, user.id);
      myActiveBooks = countActiveBooksByEditor(db, user.id);
      myPendingCount = listPendingConfirmation(db).filter((t) => t.editorId === user.id).length;
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
          {user.role !== "PROOFREADER" && user.role !== "EXTERNAL_SUPERVISOR" && (
            <Link
              href="/tasks/pending-confirmation"
              className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
            >
              待确认收稿（{isEditor ? myPendingCount : pendingCount}）
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

      <section className="mb-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <SearchBox />
        <p className="mt-2 text-xs text-gray-500">可搜索书名或责任编辑姓名，查看书稿校对历史</p>
      </section>

      <section className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {isEditor ? (
          <>
            <StatCard label="我的现有书稿" value={myActiveBooks} tone="slate" />
            <StatCard label="我的待确认" value={myPendingCount} tone="amber" />
            <StatCard label="部门书稿仓库" value={warehouse.length} tone="blue" />
            <StatCard label="我的生产线" value={myProduction.length} tone="red" />
            <StatCard label="我的已完成" value={myCompleted.length} tone="emerald" />
          </>
        ) : (
          <>
            <StatCard label="部门现有书稿" value={activeBooks} tone="slate" />
            <StatCard label="书稿仓库" value={warehouse.length} tone="amber" />
            <StatCard label="生产线" value={production.length} tone="blue" />
            <StatCard label="滞留任务" value={overdue.length} tone="red" />
            <StatCard
              label="已完成任务"
              value={completed.length}
              tone="emerald"
              href={user.role === "EXTERNAL_SUPERVISOR" ? "/tasks/completed" : undefined}
            />
          </>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[72fr_28fr] lg:items-start">
        <div className="space-y-8">
          {user.role === "EXTERNAL_SUPERVISOR" && (
            <section>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-lg font-semibold text-gray-900">待确认收稿</h2>
                <span className="text-sm text-gray-500">共 {supervisorPending.length} 条</span>
              </div>
              {shownPending.length === 0 ? (
                <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-center text-sm text-gray-400">
                  当前没有待确认收稿
                </div>
              ) : (
                <SupervisorPendingList items={shownPending} />
              )}
              {supervisorPending.length > 20 && (
                <Link
                  href="/tasks/pending-confirmation"
                  className="mt-3 inline-block w-full rounded-md border border-gray-300 bg-white px-4 py-2 text-center text-sm text-gray-600 hover:bg-gray-50"
                >
                  查看全部待确认收稿
                </Link>
              )}
            </section>
          )}

          {isEditor ? (
            <section>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-lg font-semibold text-gray-900">部门书稿仓库</h2>
                <span className="text-sm text-gray-500">共 {warehouseForDisplay.length} 条</span>
              </div>
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
                  className="rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-700"
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
                  className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
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
                <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                  {shownWarehouse.map((task) => (
                    <DashboardTaskRow
                      key={task.id}
                      task={task}
                      now={now}
                      currentUserId={user.id}
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
                <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
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
              <h2 className="text-lg font-semibold text-gray-900">{isEditor ? "我的生产线" : "生产线"}</h2>
              <span className="text-sm text-gray-500">共 {productionList.length} 条</span>
            </div>
            {productionList.length === 0 ? (
              <div className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">
                当前没有进行中的校对任务
              </div>
            ) : (
              <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                {productionList.map((task) => {
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
                <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                  {completedList.map((task) => (
                    <DashboardTaskRow key={task.id} task={task} now={now} />
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        {!isEditor && (
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
