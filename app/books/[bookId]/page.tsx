import Link from "next/link";
import { requireCurrentUser } from "@/lib/session";
import { openDatabase } from "@/lib/db";
import { getBookDetail, EVENT_LABELS, ROLE_LABELS } from "@/lib/search-service";
import { STAGE_LABELS, STATUS_LABELS, WORK_TYPE_LABELS } from "@/lib/dashboard-service";
import { wordCountText } from "@/lib/task-service";
import UserBar from "@/app/components/UserBar";

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default async function BookDetailPage({
  params,
}: {
  params: Promise<{ bookId: string }>;
}) {
  const user = await requireCurrentUser();
  const { bookId } = await params;

  const db = openDatabase();
  let detail;
  try {
    detail = getBookDetail(db, Number(bookId));
  } finally {
    db.close();
  }

  if (!detail) {
    return (
      <main className="mx-auto w-full max-w-5xl px-6 py-6">
        <header className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">书稿详情</h1>
            <Link href="/" className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
              返回首页
            </Link>
          </div>
          <UserBar name={user.display_name} role={user.role} />
        </header>
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-12 text-center text-sm text-gray-400">
          书稿不存在
        </div>
      </main>
    );
  }

  const statusLabel = detail.latestStatus ? STATUS_LABELS[detail.latestStatus] ?? detail.latestStatus : "—";
  const stageLabel = detail.latestStage ? STAGE_LABELS[detail.latestStage] ?? detail.latestStage : "—";

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-6">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">书稿详情</h1>
          <Link href="/" className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
            返回首页
          </Link>
        </div>
        <UserBar name={user.display_name} role={user.role} />
      </header>

      {/* 基本信息 */}
      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-gray-900">{detail.title}</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-gray-500">责任编辑</dt>
            <dd className="text-gray-900">{detail.editorName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-gray-500">发布单位</dt>
            <dd className="text-gray-900">{detail.publisherCompanyName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-gray-500">当前状态</dt>
            <dd className="text-gray-900">{statusLabel}</dd>
          </div>
          <div>
            <dt className="text-gray-500">当前 / 最近校次</dt>
            <dd className="text-gray-900">{stageLabel}</dd>
          </div>
          <div>
            <dt className="text-gray-500">星级</dt>
            <dd className="text-gray-900">{detail.latestStarLevel ? "★".repeat(detail.latestStarLevel) : "—"}</dd>
          </div>
          <div>
            <dt className="text-gray-500">接收外校公司</dt>
            <dd className="text-gray-900">{detail.latestCompanyName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-gray-500">校对人员</dt>
            <dd className="text-gray-900">{detail.latestProofreaderName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-gray-500">首次来稿时间</dt>
            <dd className="text-gray-900">{fmt(detail.firstPublishedAt)}</dd>
          </div>
          <div>
            <dt className="text-gray-500">最近更新时间</dt>
            <dd className="text-gray-900">{fmt(detail.latestUpdatedAt)}</dd>
          </div>
          <div className="col-span-2 sm:col-span-3">
            <dt className="text-gray-500">备注</dt>
            <dd className="text-gray-900">{detail.note ?? "—"}</dd>
          </div>
        </dl>
      </section>

      {/* 历次校对任务 */}
      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-gray-900">历次校对任务</h2>
        {detail.tasks.length === 0 ? (
          <div className="py-6 text-center text-sm text-gray-400">暂无校对任务</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {detail.tasks.map((t) => (
              <li key={t.taskId} className="py-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-amber-500">{"★".repeat(t.starLevel)}</span>
                  <span className="font-medium text-gray-900">{STAGE_LABELS[t.stage] ?? t.stage}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                    {WORK_TYPE_LABELS[t.workType] ?? "读校"}
                  </span>
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                    {STATUS_LABELS[t.status] ?? t.status}
                  </span>
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  发布人：{t.publisherName ?? "—"} · 接收外校公司：{t.companyName ?? "—"} · 校对人员：
                  {t.proofreaderName ?? "—"}
                </div>
                <div className="mt-0.5 text-xs text-gray-500">
                  工作字数：{wordCountText(t.workWordCount)} · 外校确认：
                  {wordCountText(t.externalConfirmedWordCount)}
                </div>
                <div className="mt-0.5 text-xs text-gray-500">
                  发布 {fmt(t.publishedAt)} · 确认 {fmt(t.confirmedAt)} · 开始 {fmt(t.startedAt)} · 完成{" "}
                  {fmt(t.finishedAt)}
                  {t.cancelledAt ? <> · 取消 {fmt(t.cancelledAt)}</> : null}
                </div>
                {t.note && <div className="mt-0.5 text-xs text-gray-500">备注：{t.note}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 流程时间线 */}
      <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-gray-900">流程时间线</h2>
        {detail.events.length === 0 ? (
          <div className="py-6 text-center text-sm text-gray-400">暂无流程记录</div>
        ) : (
          <ol className="space-y-2">
            {detail.events.map((e) => {
              const eventLabel = EVENT_LABELS[e.eventType] ?? e.eventType;
              const roleLabel = e.operatorRole ? ROLE_LABELS[e.operatorRole] ?? e.operatorRole : "—";
              return (
                <li key={e.eventId} className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-gray-900">{eventLabel}</span>
                    {e.isProxy === 1 && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                        代操作
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-gray-600">
                    操作人：{e.operatorName ?? "—"}（{roleLabel}）· {fmt(e.occurredAt)}
                    {e.statusTo ? <> · 状态变为 {STATUS_LABELS[e.statusTo] ?? e.statusTo}</> : null}
                  </div>
                  {e.note && (
                    <div className="mt-0.5 text-xs text-gray-500">{e.note}</div>
                  )}
                  {e.isProxy === 1 && (
                    <div className="mt-0.5 text-xs text-gray-500">
                      被代操作角色：{e.proxyRole ? ROLE_LABELS[e.proxyRole] ?? e.proxyRole : "—"}
                      {e.proxyReason ? <> · 原因：{e.proxyReason}</> : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </main>
  );
}
