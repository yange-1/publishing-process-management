"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmReceiptAction } from "@/app/tasks/pending-confirmation/actions";
import { STAGE_LABELS, WORK_TYPE_LABELS } from "@/lib/dashboard-service";
import { wordCountText, type PendingConfirmationItem } from "@/lib/task-service";

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

// 外校主管确认收稿：显示工作字数（只读），可编辑外校确认字数后再确认。
function ConfirmWithCount({ item }: { item: PendingConfirmationItem }) {
  const router = useRouter();
  const [count, setCount] = useState<string>(() =>
    (item.externalConfirmedWordCount ?? item.workWordCount) != null
      ? String(item.externalConfirmedWordCount ?? item.workWordCount)
      : "",
  );
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [message, setMessage] = useState<Message>(null);

  async function submit() {
    const num = Number(count);
    if (!Number.isInteger(num) || num <= 0) {
      setMessage({ kind: "err", text: "外校确认字数须为正整数" });
      return;
    }
    setPendingId(item.id);
    setMessage(null);
    const res = await confirmReceiptAction({
      taskId: item.id,
      externalConfirmedWordCount: num,
    });
    setPendingId(null);
    if (res.ok) {
      setMessage({ kind: "ok", text: res.message });
      router.refresh();
    } else {
      setMessage({ kind: "err", text: res.message });
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
          disabled={pendingId === item.id}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
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

// 外校主管首页「待确认收稿」展开列表：复用 confirmReceiptAction（内部复用 confirmReceipt）。
export default function SupervisorPendingList({
  items,
}: {
  items: PendingConfirmationItem[];
}) {
  return (
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
              <ConfirmWithCount item={item} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
