"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cancelTaskAction } from "@/app/tasks/warehouse/actions";
import {
  STAGE_LABELS,
  STATUS_LABELS,
  WORK_TYPE_LABELS,
} from "@/lib/dashboard-service";

type Message = { kind: "ok" | "err"; text: string } | null;

// 取消组件所需的最小任务字段（同时被 DashboardTask 与待确认列表项满足）。
export type CancelableTask = {
  id: number;
  title: string;
  stage: string;
  workType: string;
  status: string;
  editorId: number | null;
  editorName: string | null;
  companyName: string | null;
};

export default function CancelActions({
  task,
  currentRole,
  currentUserId,
}: {
  task: CancelableTask;
  currentRole: string;
  currentUserId: number;
}) {
  const router = useRouter();
  const [panelOpen, setPanelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const canCancel =
    (currentRole === "INTERNAL_ADMIN" ||
      (currentRole === "RESPONSIBLE_EDITOR" && task.editorId === currentUserId)) &&
    (task.status === "PENDING_CONFIRMATION" || task.status === "READY_TO_START");

  if (!canCancel) return null;

  async function submit() {
    if (!reason.trim()) {
      setMessage({ kind: "err", text: "请填写取消原因" });
      return;
    }
    setBusy(true);
    setMessage(null);
    const res = await cancelTaskAction({ taskId: task.id, reason: reason.trim() });
    setBusy(false);
    if (res.ok) {
      setMessage({ kind: "ok", text: res.message });
      router.refresh();
    } else {
      setMessage({ kind: "err", text: res.message });
    }
  }

  return (
    <div>
      {!panelOpen ? (
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          className="rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
        >
          取消任务
        </button>
      ) : (
        <div className="w-72 space-y-2 rounded-md border border-red-200 bg-red-50 p-3">
          <div className="space-y-0.5 text-sm text-gray-700">
            <div>
              <span className="text-gray-500">书名：</span>
              {task.title}
            </div>
            <div>
              <span className="text-gray-500">校次：</span>
              {STAGE_LABELS[task.stage] ?? task.stage} ·{" "}
              {WORK_TYPE_LABELS[task.workType] ?? "读校"}
            </div>
            <div>
              <span className="text-gray-500">状态：</span>
              {STATUS_LABELS[task.status] ?? task.status}
            </div>
            <div>
              <span className="text-gray-500">责任编辑：</span>
              {task.editorName ?? "—"}
            </div>
            <div>
              <span className="text-gray-500">接收外校公司：</span>
              {task.companyName ?? "—"}
            </div>
          </div>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            rows={2}
            placeholder="取消原因（必填，最多200字）"
            className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
          <div className="text-right text-xs text-gray-400">{reason.length}/200</div>
          <p className="text-xs text-gray-500">取消后任务不会删除，记录将保留在历史中。</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? "处理中…" : "确认取消任务"}
            </button>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              返回
            </button>
          </div>
          {message && (
            <div className={message.kind === "ok" ? "text-xs text-emerald-600" : "text-xs text-red-600"}>
              {message.text}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
