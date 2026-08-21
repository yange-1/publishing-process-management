"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmReceiptAction } from "./actions";
import type { PendingConfirmationItem } from "@/lib/task-service";

const STAGE_LABELS: Record<string, string> = {
  INITIAL_REVIEW: "初审",
  FIRST_PROOF: "一校",
  SECOND_PROOF: "二校",
  THIRD_PROOF: "三校",
  ADDITIONAL_PROOF: "加校",
  RED_CHECK: "核红",
};

type Message = { kind: "ok" | "err"; text: string } | null;

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function waitDays(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.floor((Date.now() - t) / 86400000);
}

export default function PendingList({
  items,
  currentRole,
  currentCompanyId,
}: {
  items: PendingConfirmationItem[];
  currentRole: string;
  currentCompanyId: number | null;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [message, setMessage] = useState<Message>(null);

  const isAdmin = currentRole === "INTERNAL_ADMIN";
  const isSupervisor = currentRole === "EXTERNAL_SUPERVISOR";

  async function run(taskId: number, proxyReason?: string) {
    setPendingId(taskId);
    setMessage(null);
    const res = await confirmReceiptAction({ taskId, proxyReason });
    setPendingId(null);
    if (res.ok) {
      setMessage({ kind: "ok", text: res.message });
      router.refresh();
    } else {
      setMessage({ kind: "err", text: res.message });
    }
  }

  function handleProxy(taskId: number) {
    const reason = window.prompt("请输入代确认原因（必填，最多200字）：");
    if (reason == null) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setMessage({ kind: "err", text: "请填写代确认原因" });
      return;
    }
    if (trimmed.length > 200) {
      setMessage({ kind: "err", text: "代确认原因最多200字" });
      return;
    }
    run(taskId, trimmed);
  }

  return (
    <div className="space-y-4">
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

      {items.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-12 text-center text-sm text-gray-400">
          当前没有待确认收稿的任务
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          {items.map((item) => {
            const canConfirm =
              isSupervisor && item.companyId === currentCompanyId;
            const canProxy = isAdmin;
            const actionable = canConfirm || canProxy;
            return (
              <li key={item.id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="w-14 shrink-0 text-sm text-amber-500">
                    {"★".repeat(item.starLevel)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-gray-900">
                        {item.title}
                      </span>
                      <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">
                        {STAGE_LABELS[item.stage] ?? item.stage}
                      </span>
                      <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                        待确认收稿
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-gray-500">
                      责任编辑：{item.editorName ?? "—"} · 发布单位：
                      {item.publisherCompanyName ?? "—"} · 接收外校公司：
                      {item.companyName ?? "—"} · 来稿 {fmtDate(item.publishedAt)} ·
                      已等待 {waitDays(item.publishedAt)} 天
                    </div>
                  </div>
                  <div className="shrink-0">
                    {actionable ? (
                      pendingId === item.id ? (
                        <span className="inline-block rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-400">
                          处理中…
                        </span>
                      ) : canConfirm ? (
                        <button
                          type="button"
                          onClick={() => run(item.id)}
                          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                        >
                          确认收稿
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleProxy(item.id)}
                          className="rounded-md border border-amber-400 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50"
                        >
                          代确认
                        </button>
                      )
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
