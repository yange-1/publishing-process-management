"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deliverTaskAction } from "@/app/tasks/warehouse/actions";

type Message = { kind: "ok" | "err"; text: string } | null;

// 送达按钮：外校主管「送达」；Dominance「代送达」（须填代操作原因）。
export default function DeliverActions({
  taskId,
  currentRole,
}: {
  taskId: number;
  currentRole: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<Message>(null);

  const isSupervisor = currentRole === "EXTERNAL_SUPERVISOR";
  const isAdmin = currentRole === "INTERNAL_ADMIN";
  if (!isSupervisor && !isAdmin) return null;

  async function run(proxyReason?: string) {
    setBusy(true);
    setMessage(null);
    const res = await deliverTaskAction({ taskId, proxyReason });
    setBusy(false);
    if (res.ok) {
      setMessage({ kind: "ok", text: res.message });
      router.refresh();
    } else {
      setMessage({ kind: "err", text: res.message });
    }
  }

  async function handleProxy() {
    if (!reason.trim()) {
      setMessage({ kind: "err", text: "请填写代操作原因" });
      return;
    }
    await run(reason.trim());
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {message && (
        <div
          className={message.kind === "ok" ? "text-xs text-emerald-600" : "text-xs text-red-600"}
        >
          {message.text}
        </div>
      )}

      {isSupervisor && (
        <button
          type="button"
          disabled={busy}
          onClick={() => run()}
          className="rounded-md bg-[#FF5A1F] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#E94710] disabled:opacity-50"
        >
          {busy ? "处理中…" : "送达"}
        </button>
      )}

      {isAdmin && !panelOpen && (
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          className="rounded-md border border-amber-400 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-50"
        >
          代送达
        </button>
      )}

      {isAdmin && panelOpen && (
        <div className="w-64 space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            rows={2}
            placeholder="代操作原因（必填，最多200字）"
            className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={handleProxy}
              className="rounded-md bg-[#FF5A1F] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#E94710] disabled:opacity-50"
            >
              {busy ? "处理中…" : "确认代送达"}
            </button>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
