"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmReceiptAction } from "@/app/tasks/pending-confirmation/actions";
import { STAGE_LABELS, WORK_TYPE_LABELS } from "@/lib/dashboard-service";
import { wordCountText, type PendingConfirmationItem } from "@/lib/task-service";
import { stageColor } from "./stage-colors";

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
          className="rounded-md bg-[#FF5A1F] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#E94710] disabled:opacity-50"
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
    <ul className="space-y-2">
      {items.map((item) => {
        const c = stageColor(item.stage);
        return (
          <li
            key={item.id}
            className={`rounded-lg border border-[#E6E8EC] border-l-4 bg-white px-4 py-3 shadow-sm transition hover:shadow-md ${c.strip}`}
          >
            <div className="flex items-start gap-3">
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${c.icon} ${c.iconText}`}
              >
                {c.short}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="shrink-0 text-sm text-amber-500">
                    {"★".repeat(item.starLevel)}
                  </span>
                  <span className="min-w-0 truncate text-sm font-bold text-[#172033]" title={item.title}>
                    {item.title}
                  </span>
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${c.badge}`}>
                    {STAGE_LABELS[item.stage] ?? item.stage}
                  </span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                    {WORK_TYPE_LABELS[item.workType] ?? "读校"}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-xs text-[#667085]">
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
        );
      })}
    </ul>
  );
}
