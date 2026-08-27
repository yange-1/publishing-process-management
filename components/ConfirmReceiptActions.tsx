"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmDeliveryReceiptAction } from "@/app/tasks/warehouse/actions";

type Message = { kind: "ok" | "err"; text: string } | null;

// 责任编辑「确认“收货”」按钮：确认人与确认时间由服务端按登录会话自动记录。
export default function ConfirmReceiptActions({ taskId }: { taskId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  async function run() {
    setBusy(true);
    setMessage(null);
    const res = await confirmDeliveryReceiptAction({ taskId });
    setBusy(false);
    if (res.ok) {
      setMessage({ kind: "ok", text: res.message });
      router.refresh();
    } else {
      setMessage({ kind: "err", text: res.message });
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {message && (
        <div
          className={message.kind === "ok" ? "text-xs text-emerald-600" : "text-xs text-red-600"}
        >
          {message.text}
        </div>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={run}
        className="rounded-md bg-[#FF5A1F] px-3 py-2 text-sm font-medium text-white hover:bg-[#E94710] disabled:opacity-50"
      >
        {busy ? "处理中…" : "确认“收货”"}
      </button>
    </div>
  );
}
