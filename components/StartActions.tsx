"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startTaskAction } from "@/app/tasks/warehouse/actions";
import EditorCombobox from "@/app/tasks/new/EditorCombobox";
import type { ProofreaderOption } from "@/lib/task-service";

type Message = { kind: "ok" | "err"; text: string } | null;

export default function StartActions({
  taskId,
  taskCompanyId,
  currentRole,
  currentCompanyId,
  proofreaders,
}: {
  taskId: number;
  taskCompanyId: number | null;
  currentRole: string;
  currentCompanyId: number | null;
  proofreaders: ProofreaderOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [proofreaderId, setProofreaderId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<Message>(null);

  const canSelfStart =
    currentRole === "PROOFREADER" && taskCompanyId === currentCompanyId;
  const isAdmin = currentRole === "INTERNAL_ADMIN";

  if (!canSelfStart && !isAdmin) return null;

  async function run(proxyId?: number, proxyReason?: string) {
    setBusy(true);
    setMessage(null);
    const res = await startTaskAction({ taskId, proofreaderId: proxyId, proxyReason });
    setBusy(false);
    if (res.ok) {
      setMessage({ kind: "ok", text: res.message });
      router.refresh();
    } else {
      setMessage({ kind: "err", text: res.message });
    }
  }

  async function handleProxy() {
    if (proofreaderId == null) {
      setMessage({ kind: "err", text: "请选择目标校对人员" });
      return;
    }
    if (!reason.trim()) {
      setMessage({ kind: "err", text: "请填写代操作原因" });
      return;
    }
    await run(proofreaderId, reason.trim());
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

      {canSelfStart && (
        <button
          type="button"
          disabled={busy}
          onClick={() => run()}
          className="rounded-md bg-[#FF5A1F] px-4 py-2 text-sm font-medium text-white hover:bg-[#E94710] disabled:opacity-50"
        >
          {busy ? "处理中…" : "开始校对"}
        </button>
      )}

      {isAdmin && !panelOpen && (
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          className="rounded-md border border-amber-400 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50"
        >
          代开始
        </button>
      )}

      {isAdmin && panelOpen && (
        <div className="w-64 space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
          <EditorCombobox
            editors={proofreaders}
            value={proofreaderId}
            onChange={setProofreaderId}
            placeholder="搜索校对人员姓名或登录账号"
            emptyText="没有匹配的校对人员"
          />
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
              {busy ? "处理中…" : "确认代开始"}
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
