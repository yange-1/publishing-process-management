"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmReceiptAction } from "@/app/tasks/pending-confirmation/actions";
import { STAGE_LABELS, WORK_TYPE_LABELS } from "@/lib/dashboard-service";
import type { PendingConfirmationItem } from "@/lib/task-service";

type Message = { kind: "ok" | "err"; text: string } | null;

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function waitDays(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.floor((Date.now() - t) / 86400000);
}

// 外校主管首页「待确认收稿」展开列表：复用 confirmReceiptAction（内部复用 confirmReceipt）。
export default function SupervisorPendingList({
  items,
}: {
  items: PendingConfirmationItem[];
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [message, setMessage] = useState<Message>(null);

  async function run(taskId: number) {
    setPendingId(taskId);
    setMessage(null);
    const res = await confirmReceiptAction({ taskId });
    setPendingId(null);
    if (res.ok) {
      setMessage({ kind: "ok", text: res.message });
      router.refresh();
    } else {
      setMessage({ kind: "err", text: res.message });
    }
  }

  return (
    <div className="space-y-2">
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
      <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        {items.map((item) => (
          <li key={item.id} className="px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="w-14 shrink-0 text-sm text-amber-500">
                {"★".repeat(item.starLevel)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-gray-900" title={item.title}>
                    {item.title}
                  </span>
                  <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">
                    {STAGE_LABELS[item.stage] ?? item.stage}
                  </span>
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                    {WORK_TYPE_LABELS[item.workType] ?? "读校"}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-xs text-gray-500">
                  责任编辑：{item.editorName ?? "—"} · 发布单位：
                  {item.publisherCompanyName ?? "—"} · 来稿 {fmtDate(item.publishedAt)} · 已等待{" "}
                  {waitDays(item.publishedAt)} 天
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href={`/books/${item.bookId}`}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                >
                  查看历史
                </Link>
                <button
                  type="button"
                  disabled={pendingId === item.id}
                  onClick={() => run(item.id)}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {pendingId === item.id ? "处理中…" : "确认收稿"}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
