"use client";

import { signOut } from "next-auth/react";

const ROLE_LABELS: Record<string, string> = {
  RESPONSIBLE_EDITOR: "责任编辑",
  EXTERNAL_SUPERVISOR: "外校公司主管",
  PROOFREADER: "校对人员",
  INTERNAL_ADMIN: "Dominance",
};

export default function UserBar({ name, role }: { name: string; role: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-gray-600">
        {name} · {ROLE_LABELS[role] ?? role}
      </span>
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
      >
        退出
      </button>
    </div>
  );
}
