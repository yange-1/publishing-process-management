import Link from "next/link";
import { requireCurrentUser } from "@/lib/session";
import { openDatabase } from "@/lib/db";
import { searchBooks, proofreaderStartDecision, hasInProgressTask } from "@/lib/search-service";
import { STAGE_LABELS, STATUS_LABELS, WORK_TYPE_LABELS } from "@/lib/dashboard-service";
import UserBar from "@/app/components/UserBar";
import SearchBox from "@/components/SearchBox";
import SearchStartActions from "@/components/SearchStartActions";

const PAGE_SIZE = 20;
const MAX_QUERY_LENGTH = 100;

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCurrentUser();
  const sp = await searchParams;
  const rawQ = typeof sp.q === "string" ? sp.q : "";
  const q = rawQ.trim().slice(0, MAX_QUERY_LENGTH);
  const page = Math.max(1, Number.parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1);

  let result = { results: [] as Awaited<ReturnType<typeof searchBooks>>["results"], total: 0, page, pageSize: PAGE_SIZE };
  let hasInProgress = false;
  if (q) {
    const db = openDatabase();
    try {
      result = searchBooks(db, q, page, PAGE_SIZE);
      hasInProgress = user.role === "PROOFREADER" ? hasInProgressTask(db, user.id) : false;
    } finally {
      db.close();
    }
  }

  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const hasMore = page < totalPages;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-6">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">书稿搜索</h1>
          <Link href="/" className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
            返回首页
          </Link>
        </div>
        <UserBar name={user.display_name} role={user.role} />
      </header>

      <section className="mb-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <SearchBox defaultValue={q} />
      </section>

      {!q ? (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-12 text-center text-sm text-gray-400">
          请输入书名或责任编辑姓名
        </div>
      ) : result.results.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-12 text-center text-sm text-gray-400">
          未找到符合条件的书稿
        </div>
      ) : (
        <>
          <p className="mb-2 text-sm text-gray-500">共 {result.total} 条结果</p>
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            {result.results.map((r) => (
              <li key={r.bookId} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="w-14 shrink-0 text-sm text-amber-500">
                    {"★".repeat(r.starLevel ?? 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-gray-900" title={r.title}>
                        {r.title}
                      </span>
                      <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">
                        {r.stage ? STAGE_LABELS[r.stage] ?? r.stage : "—"}
                      </span>
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                        {r.workType ? WORK_TYPE_LABELS[r.workType] ?? r.workType : "读校"}
                      </span>
                      <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                        {r.status ? STATUS_LABELS[r.status] ?? r.status : "—"}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-gray-500">
                      责任编辑：{r.editorName ?? "—"} · 发布单位：{r.publisherCompanyName ?? "—"} · 接收外校公司：
                      {r.companyName ?? "—"} · 来稿 {fmt(r.publishedAt)} · 确认 {fmt(r.confirmedAt)} ·
                      开始 {fmt(r.startedAt)} · 完成 {fmt(r.finishedAt)} · 校对人员：{r.proofreaderName ?? "—"}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {(() => {
                      const d = proofreaderStartDecision(
                        user.role,
                        r.status,
                        r.companyId,
                        user.company_id ?? null,
                        hasInProgress,
                      );
                      if (d.showStart && r.taskId != null) {
                        return <SearchStartActions taskId={r.taskId} />;
                      }
                      if (d.showBusyHint) {
                        return (
                          <span className="text-xs text-amber-600">
                            你已有正在校对的任务，请先完成当前任务
                          </span>
                        );
                      }
                      return null;
                    })()}
                    <Link
                      href={`/books/${r.bookId}`}
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                    >
                      查看校对历史
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-gray-500">
              第 {page} / {totalPages} 页
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link
                  href={`/search?q=${encodeURIComponent(q)}&page=${page - 1}`}
                  className="rounded-md border border-gray-300 px-4 py-2 text-gray-600 hover:bg-gray-50"
                >
                  上一页
                </Link>
              )}
              {hasMore && (
                <Link
                  href={`/search?q=${encodeURIComponent(q)}&page=${page + 1}`}
                  className="rounded-md border border-gray-300 px-4 py-2 text-gray-600 hover:bg-gray-50"
                >
                  下一页
                </Link>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
