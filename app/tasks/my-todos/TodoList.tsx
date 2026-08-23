"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmReceiptAction } from "@/app/tasks/pending-confirmation/actions";
import FinishActions from "@/components/FinishActions";
import {
  STAGE_LABELS,
  STATUS_LABELS,
  WORK_TYPE_LABELS,
} from "@/lib/dashboard-service";
import { wordCountText } from "@/lib/task-service";
import type { TodoGroup, TodoSummary } from "@/lib/todo-service";

const GROUP_LABELS: Record<TodoGroup, string> = {
  urgent: "需要立即处理",
  waiting: "等待处理中",
  in_progress: "进行中",
  completed: "最近完成",
};

const PAGE_SIZE = 20;

type Message = { kind: "ok" | "err"; text: string } | null;

// 外校主管确认收稿：显示工作字数（只读），可编辑外校确认字数后再确认。
function SupervisorConfirm({
  item,
}: {
  item: { id: number; workWordCount: number | null; externalConfirmedWordCount: number | null };
}) {
  const router = useRouter();
  const [count, setCount] = useState<string>(() =>
    (item.externalConfirmedWordCount ?? item.workWordCount) != null
      ? String(item.externalConfirmedWordCount ?? item.workWordCount)
      : "",
  );
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const runningRef = useRef(false);

  async function submit() {
    if (runningRef.current) return;
    const num = Number(count);
    if (!Number.isInteger(num) || num <= 0) {
      setMessage({ kind: "err", text: "外校确认字数须为正整数" });
      return;
    }
    runningRef.current = true;
    setPendingId(item.id);
    setMessage(null);
    try {
      const res = await confirmReceiptAction({
        taskId: item.id,
        externalConfirmedWordCount: num,
      });
      setMessage({ kind: res.ok ? "ok" : "err", text: res.message });
      if (res.ok) router.refresh();
    } finally {
      setPendingId(null);
      runningRef.current = false;
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <span className="text-xs text-gray-500">
        工作字数：{wordCountText(item.workWordCount)}
      </span>
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-gray-500">外校确认字数</label>
        <input
          type="number"
          min={1}
          step={1}
          value={count}
          onChange={(e) => setCount(e.target.value)}
          className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={submit}
          disabled={pendingId !== null}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pendingId === item.id ? "处理中…" : "确认收稿"}
        </button>
      </div>
      {message && (
        <div
          className={message.kind === "ok" ? "text-xs text-emerald-600" : "text-xs text-red-600"}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}

export default function TodoList({
  summary,
  currentRole,
  currentCompanyId,
  currentUserId,
}: {
  summary: TodoSummary;
  currentRole: string;
  currentCompanyId: number | null;
  currentUserId: number;
}) {
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
                      <div className="mt-0.5 truncate text-xs text-gray-500">
                        工作字数：{wordCountText(item.workWordCount)} · 外校确认：
                        {wordCountText(item.externalConfirmedWordCount)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {canConfirm(item.status, item.companyId) ? (
                        <SupervisorConfirm item={item} />
                      ) : (
                        <span className="text-xs text-gray-600">
                          {item.actionHint}
                        </span>
                      )}
                      {item.status === "IN_PROGRESS" && (
                        <FinishActions
                          taskId={item.id}
                          taskProofreaderId={item.proofreaderId}
                          currentRole={currentRole}
                          currentUserId={currentUserId}
                        />
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
