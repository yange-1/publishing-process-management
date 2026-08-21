"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { finishTaskAction } from "@/app/tasks/warehouse/actions";

type Message = { kind: "ok" | "err"; text: string } | null;

export default function FinishActions({
  taskId,
  taskProofreaderId,
  currentRole,
  currentUserId,
}: {
  taskId: number;
  taskProofreaderId: number | null;
  currentRole: string;
  currentUserId: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<Message>(null);

  const canSelfFinish =
    currentRole === "PROOFREADER" && taskProofreaderId === currentUserId;
  const isAdmin = currentRole === "INTERNAL_ADMIN";

  if (!canSelfFinish && !isAdmin) return null;

  async function run(proxyReason?: string) {
    setBusy(true);
    setMessage(null);
    const res = await finishTaskAction({ taskId, proxyReason });
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
    <div className="space-y-2">
      {message && (
        <div
          className={
            message.kind === "ok" ? "text-xs text-emerald-600" : "text-xs text-red-600"
          }
        >
          {message.text}
        </div>
      )}

      {canSelfFinish && (
        <button
          type="button"
          disabled={busy}
          onClick={() => run()}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? "处理中…" : "结束校对"}
        </button>
      )}

      {isAdmin && !panelOpen && (
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          className="rounded-md border border-amber-400 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50"
        >
          代结束
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
              className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {busy ? "处理中…" : "确认代结束"}
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
