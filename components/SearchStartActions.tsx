"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startTaskAction } from "@/app/tasks/warehouse/actions";

type Message = { kind: "ok" | "err"; text: string } | null;

// 搜索结果中的“开始校对”按钮：复用现有 startTaskAction（内部复用 startTask 服务）。
export default function SearchStartActions({ taskId }: { taskId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  async function run() {
    setBusy(true);
    setMessage(null);
    const res = await startTaskAction({ taskId });
    setBusy(false);
    if (res.ok) {
      setMessage({ kind: "ok", text: res.message });
      router.refresh();
    } else {
      setMessage({ kind: "err", text: res.message });
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={run}
        className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? "处理中…" : "开始校对"}
      </button>
      {message && (
        <span
          className={
            message.kind === "ok" ? "text-xs text-emerald-600" : "text-xs text-red-600"
          }
        >
          {message.text}
        </span>
      )}
    </div>
  );
}
