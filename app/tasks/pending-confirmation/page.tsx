import Link from "next/link";
import { requireCurrentUser } from "@/lib/session";
import { openDatabase } from "@/lib/db";
import { listPendingConfirmation } from "@/lib/task-service";
import UserBar from "@/app/components/UserBar";
import PendingList from "./PendingList";

export default async function PendingConfirmationPage() {
  // 开放查看：所有已登录、已启用、已完成首次改密的账号均可查看列表。
  const user = await requireCurrentUser();

  const db = openDatabase();
  let items;
  try {
    items = listPendingConfirmation(db);
  } finally {
    db.close();
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-6">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">待确认收稿</h1>
          <Link
            href="/"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            返回首页
          </Link>
        </div>
        <UserBar name={user.display_name} role={user.role} />
      </header>

      <PendingList
        items={items}
        currentRole={user.role}
        currentCompanyId={user.company_id ?? null}
        currentUserId={user.id}
      />
    </main>
  );
}
