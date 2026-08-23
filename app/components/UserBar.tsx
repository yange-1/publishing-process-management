"use client";

import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";

const ROLE_LABELS: Record<string, string> = {
  RESPONSIBLE_EDITOR: "责任编辑",
  EXTERNAL_SUPERVISOR: "外校公司主管",
  PROOFREADER: "校对人员",
  INTERNAL_ADMIN: "Dominance",
};

export default function UserBar({ name, role }: { name: string; role: string }) {
  const router = useRouter();

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-gray-600">
        {name} · {ROLE_LABELS[role] ?? role}
      </span>
      <button
        type="button"
        onClick={async () => {
          // 退出后清除会话，再由客户端路由跳到相对 /login，
          // 自动沿用当前访问主机（避免 next-auth 解析到默认的 http://localhost:3000）。
          await signOut({ redirect: false });
          router.push("/login");
        }}
        className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
      >
        退出
      </button>
    </div>
  );
}
