"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmReceiptAction } from "@/app/tasks/pending-confirmation/actions";
import {
  STAGE_LABELS,
  STATUS_LABELS,
  WORK_TYPE_LABELS,
} from "@/lib/dashboard-service";
import type { TodoGroup, TodoSummary } from "@/lib/todo-service";

const GROUP_LABELS: Record<TodoGroup, string> = {
  urgent: "需要立即处理",
  waiting: "等待处理中",
  in_progress: "进行中",
  completed: "最近完成",
};

const PAGE_SIZE = 20;

type Message = { kind: "ok" | "err"; text: string } | null;

export default function TodoList({
  summary,
  currentRole,
  currentCompanyId,
}: {
  summary: TodoSummary;
  currentRole: string;
  currentCompanyId: number | null;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const runningRef = useRef(false);

  async function run(taskId: number) {
    if (runningRef.current) return;
    runningRef.current = true;
    setPendingId(taskId);
    setMessage(null);
    try {
      const res = await confirmReceiptAction({ taskId });
      setMessage({ kind: res.ok ? "ok" : "err", text: res.message });
      if (res.ok) router.refresh();
    } finally {
      setPendingId(null);
      runningRef.current = false;
    }
  }

  function canConfirm(status: string, companyId: number | null): boolean {
    return (
      currentRole === "EXTERNAL_SUPERVISOR" &&
      status === "PENDING_CONFIRMATION" &&
      companyId === currentCompanyId
    );
  }

  const groups: TodoGroup[] = ["urgent", "waiting", "in_progress", "completed"];

  return (
    <div className="space-y-6">
      {message && (
        <div
          className={
            message.kind === "ok"
              ? "rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700"
              : "rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
          }
        >
          {message.text}
        </div>
      )}

      {groups.map((group) => {
        const items = summary.items.filter((i) => i.group === group);
        if (items.length === 0) return null;
        const shown = items.slice(0, PAGE_SIZE);
        return (
          <section key={group}>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-base font-semibold text-gray-900">
                {GROUP_LABELS[group]}
              </h2>
              <span className="text-sm text-gray-500">共 {items.length} 条</span>
            </div>
            <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              {shown.map((item) => (
                <li key={item.id} className="px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <span className="w-14 shrink-0 text-sm text-amber-500">
                      {"★".repeat(item.starLevel)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className="truncate font-medium text-gray-900"
                          title={item.title}
                        >
                          {item.title}
                        </span>
                        <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">
                          {STAGE_LABELS[item.stage] ?? item.stage}
                        </span>
                        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                          {WORK_TYPE_LABELS[item.workType] ?? "读校"}
                        </span>
                        <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                          {STATUS_LABELS[item.status] ?? item.status}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-gray-500">
                        责任编辑：{item.editorName ?? "—"} · 接收外校公司：
                        {item.companyName ?? "—"} · 已等待 {item.waitDays} 天
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {canConfirm(item.status, item.companyId) ? (
                        pendingId === item.id ? (
                          <span className="inline-block rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-400">
                            处理中…
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => run(item.id)}
                            disabled={pendingId !== null}
                            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            确认收稿
                          </button>
                        )
                      ) : (
                        <span className="text-xs text-gray-600">
                          {item.actionHint}
                        </span>
                      )}
                      <Link
                        href={`/books/${item.bookId}`}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                      >
                        查看历史
                      </Link>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {items.length > PAGE_SIZE && (
              <div className="mt-2 text-right text-sm text-gray-500">
                仅显示前 {PAGE_SIZE} 条，共 {items.length} 条
              </div>
            )}
          </section>
        );
      })}

      {summary.items.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-12 text-center text-sm text-gray-400">
          {currentRole === "PROOFREADER"
            ? "当前没有进行中的校对任务"
            : "当前没有需要处理的待办"}
        </div>
      )}
    </div>
  );
}
