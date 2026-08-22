import Link from "next/link";
import { requireCurrentUser } from "@/lib/session";
import { openDatabase } from "@/lib/db";
import { listCompletedPage } from "@/lib/dashboard-service";
import UserBar from "@/app/components/UserBar";
import DashboardTaskRow from "@/components/DashboardTaskRow";

const PAGE_SIZE = 20;

export default async function CompletedPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCurrentUser();
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1);
  const now = new Date();

  const db = openDatabase();
  let result: Awaited<ReturnType<typeof listCompletedPage>>;
  try {
    // 外校主管只看本公司已完成；其他角色开放查看全部已完成。
    const companyId = user.role === "EXTERNAL_SUPERVISOR" ? user.company_id : null;
    result = listCompletedPage(db, companyId, page, PAGE_SIZE);
  } finally {
    db.close();
  }

  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-6">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">已完成任务</h1>
          <Link
            href="/"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            返回首页
          </Link>
        </div>
        <UserBar name={user.display_name} role={user.role} />
      </header>

      <p className="mb-2 text-sm text-gray-500">共 {result.total} 条已完成任务</p>

      {result.items.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-12 text-center text-sm text-gray-400">
          当前没有已完成的校对任务
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          {result.items.map((task) => (
            <DashboardTaskRow key={task.id} task={task} now={now} />
          ))}
        </ul>
      )}

      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-gray-500">
          第 {page} / {totalPages} 页
        </span>
        <div className="flex gap-2">
          {page > 1 && (
            <Link
              href={`/tasks/completed?page=${page - 1}`}
              className="rounded-md border border-gray-300 px-4 py-2 text-gray-600 hover:bg-gray-50"
            >
              上一页
            </Link>
          )}
          {page < totalPages && (
            <Link
              href={`/tasks/completed?page=${page + 1}`}
              className="rounded-md border border-gray-300 px-4 py-2 text-gray-600 hover:bg-gray-50"
            >
              下一页
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
