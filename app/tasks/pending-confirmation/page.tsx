import Link from "next/link";
import { requireCurrentUser } from "@/lib/session";
import { openDatabase } from "@/lib/db";
import { listPendingConfirmation } from "@/lib/task-service";
import UserBar from "@/app/components/UserBar";
import PendingList from "./PendingList";

export default async function PendingConfirmationPage() {
  const user = await requireCurrentUser();

  // 服务端权限过滤：责任编辑只能看到自己发布的待确认任务（books.editor_id = 本人），
  // 外校主管只能看到本公司的待确认任务，管理员查看全部；计数与列表复用同一范围规则。
  const isEditor = user.role === "RESPONSIBLE_EDITOR";
  const isSupervisor = user.role === "EXTERNAL_SUPERVISOR";
  const scope = isEditor
    ? { editorId: user.id }
    : isSupervisor && user.company_id != null
      ? { companyId: user.company_id }
      : undefined;

  const db = openDatabase();
  let items;
  try {
    items = listPendingConfirmation(db, scope);
  } finally {
    db.close();
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-6">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">
            {isEditor ? "我的待确认" : "待确认收稿"}
          </h1>
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
