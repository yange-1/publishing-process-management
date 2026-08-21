import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/session";
import { openDatabase } from "@/lib/db";
import {
  listActiveExternalCompanies,
  listBooks,
  listActiveEditors,
  isAdminRole,
} from "@/lib/task-service";
import UserBar from "@/app/components/UserBar";
import PublishForm from "./PublishForm";

export default async function NewTaskPage() {
  const user = await requireCurrentUser();
  if (user.role !== "RESPONSIBLE_EDITOR" && user.role !== "INTERNAL_ADMIN") {
    redirect("/");
  }

  const db = openDatabase();
  let externalCompanies;
  let books;
  let editors;
  try {
    externalCompanies = listActiveExternalCompanies(db);
    books = listBooks(db, user.role === "RESPONSIBLE_EDITOR" ? user.id : undefined);
    editors = listActiveEditors(db);
  } finally {
    db.close();
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-6">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">发布校对任务</h1>
          <Link
            href="/"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            返回首页
          </Link>
        </div>
        <UserBar name={user.display_name} role={user.role} />
      </header>

      <PublishForm
        isAdmin={isAdminRole(user.role)}
        externalCompanies={externalCompanies}
        books={books}
        editors={editors}
      />
    </main>
  );
}
