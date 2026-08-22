import Link from "next/link";
import { requireCurrentUser } from "@/lib/session";
import { openDatabase } from "@/lib/db";
import { listMyTodos } from "@/lib/todo-service";
import UserBar from "@/app/components/UserBar";
import TodoList from "./TodoList";

export default async function MyTodosPage() {
  const user = await requireCurrentUser();

  const db = openDatabase();
  let summary;
  try {
    summary = listMyTodos(db, { id: user.id, role: user.role, companyId: user.company_id ?? null });
  } finally {
    db.close();
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-6">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">我的待办</h1>
          <Link href="/" className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
            返回首页
          </Link>
        </div>
        <UserBar name={user.display_name} role={user.role} />
      </header>

      <p className="mb-4 text-sm text-gray-500">
        当前共有 {summary.activeCount} 项需要处理的事项。
      </p>

      <TodoList
        summary={summary}
        currentRole={user.role}
        currentCompanyId={user.company_id ?? null}
      />
    </main>
  );
}
