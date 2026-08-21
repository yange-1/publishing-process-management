"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUserAction,
  resetUserPasswordAction,
  deactivateUserAction,
  activateUserAction,
} from "./actions";
import type { UserListItem } from "@/lib/user-admin-service";

const ROLE_LABELS: Record<string, string> = {
  RESPONSIBLE_EDITOR: "责任编辑",
  EXTERNAL_SUPERVISOR: "外校公司主管",
  PROOFREADER: "校对人员",
  INTERNAL_ADMIN: "社内校对主管",
};

const CREATE_ROLE_OPTIONS = [
  { value: "RESPONSIBLE_EDITOR", label: "责任编辑" },
  { value: "EXTERNAL_SUPERVISOR", label: "外校公司主管" },
  { value: "PROOFREADER", label: "校对人员" },
];

type Message = { kind: "ok" | "err"; text: string } | null;

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function UserAdminPanel({
  currentUserId,
  adminCompanyName,
  users,
}: {
  currentUserId: number;
  adminCompanyName: string;
  users: UserListItem[];
}) {
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("RESPONSIBLE_EDITOR");
  const [companyName, setCompanyName] = useState("");

  const [message, setMessage] = useState<Message>(null);
  const [creating, setCreating] = useState(false);
  const [pendingId, setPendingId] = useState<number | null>(null);

  const total = users.length;
  const active = users.filter((u) => u.is_active).length;
  const inactive = total - active;
  const mustChange = users.filter((u) => u.must_change_password).length;
  const editors = users.filter((u) => u.role === "RESPONSIBLE_EDITOR").length;
  const supervisors = users.filter((u) => u.role === "EXTERNAL_SUPERVISOR").length;
  const proofreaders = users.filter((u) => u.role === "PROOFREADER").length;

  const filtered = users.filter((u) => {
    if (search) {
      const q = search.trim().toLowerCase();
      if (!u.username.toLowerCase().includes(q) && !u.display_name.toLowerCase().includes(q)) {
        return false;
      }
    }
    if (roleFilter && u.role !== roleFilter) return false;
    if (statusFilter === "active" && !u.is_active) return false;
    if (statusFilter === "inactive" && u.is_active) return false;
    return true;
  });

  function clearFilters() {
    setSearch("");
    setRoleFilter("");
    setStatusFilter("");
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (creating) return;
    const uname = username.trim();
    const dname = displayName.trim();
    const comp = role === "RESPONSIBLE_EDITOR" ? adminCompanyName : companyName.trim();
    if (!uname || !dname) {
      setMessage({ kind: "err", text: "请填写登录账号和显示姓名" });
      return;
    }
    if (role !== "RESPONSIBLE_EDITOR" && !comp) {
      setMessage({ kind: "err", text: "请填写外校公司名称" });
      return;
    }
    setCreating(true);
    setMessage(null);
    const res = await createUserAction({
      username: uname,
      displayName: dname,
      role,
      companyName: comp,
    });
    setCreating(false);
    if (res.ok) {
      setMessage({ kind: "ok", text: res.message });
      setUsername("");
      setDisplayName("");
      router.refresh();
    } else {
      setMessage({ kind: "err", text: res.message });
    }
  }

  async function handleReset(id: number) {
    if (
      !window.confirm(
        "确认将该账号密码重置为123456吗？该用户当前会话将失效，并需要再次修改密码。",
      )
    ) {
      return;
    }
    setPendingId(id);
    const res = await resetUserPasswordAction(id);
    setPendingId(null);
    if (res.ok) {
      setMessage({ kind: "ok", text: res.message });
      router.refresh();
    } else {
      setMessage({ kind: "err", text: res.message });
    }
  }

  async function handleDeactivate(id: number) {
    if (!window.confirm("停用后该用户将立即无法登录，已有会话也会失效。是否继续？")) {
      return;
    }
    setPendingId(id);
    const res = await deactivateUserAction(id);
    setPendingId(null);
    if (res.ok) {
      setMessage({ kind: "ok", text: res.message });
      router.refresh();
    } else {
      setMessage({ kind: "err", text: res.message });
    }
  }

  async function handleActivate(id: number) {
    setPendingId(id);
    const res = await activateUserAction(id);
    setPendingId(null);
    if (res.ok) {
      setMessage({ kind: "ok", text: res.message });
      router.refresh();
    } else {
      setMessage({ kind: "err", text: res.message });
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500">
        新账号初始密码统一为123456，首次登录必须修改密码。
      </p>

      {/* 统计 */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {[
          ["全部账号", total],
          ["已启用", active],
          ["已停用", inactive],
          ["待首次改密", mustChange],
          ["责任编辑", editors],
          ["外校主管", supervisors],
          ["校对人员", proofreaders],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-center shadow-sm"
          >
            <div className="text-xs text-gray-500">{label}</div>
            <div className="mt-0.5 text-xl font-bold text-gray-900">{value}</div>
          </div>
        ))}
      </section>

      {/* 创建账号 */}
      <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-gray-900">创建账号</h2>
        <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 sm:grid-cols-5">
          <div>
            <label className="mb-1 block text-sm text-gray-600">登录账号</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">显示姓名</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">角色</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              {CREATE_ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">部门 / 公司</label>
            {role === "RESPONSIBLE_EDITOR" ? (
              <input
                type="text"
                value={adminCompanyName}
                readOnly
                className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500"
              />
            ) : (
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="外校公司名称"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            )}
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={creating}
              className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {creating ? "正在创建…" : "创建账号"}
            </button>
          </div>
        </form>
      </section>

      {/* 搜索与筛选 */}
      <section className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索登录账号或姓名"
          className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">全部角色</option>
          {Object.entries(ROLE_LABELS).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">全部状态</option>
          <option value="active">已启用</option>
          <option value="inactive">已停用</option>
        </select>
        <button
          type="button"
          onClick={clearFilters}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          清除筛选
        </button>
      </section>

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

      {/* 账号列表 */}
      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="hidden grid-cols-[1.2fr_1fr_0.9fr_1fr_0.6fr_0.8fr_1fr_1fr_1.6fr] gap-3 border-b border-gray-100 bg-gray-50 px-4 py-2 text-xs font-medium text-gray-500 sm:grid">
          <span>登录账号</span>
          <span>姓名</span>
          <span>角色</span>
          <span>部门 / 公司</span>
          <span>状态</span>
          <span>密码</span>
          <span>最近登录</span>
          <span>创建时间</span>
          <span>操作</span>
        </div>
        <ul className="divide-y divide-gray-100">
          {filtered.map((u) => {
            const isSelf = u.id === currentUserId;
            const isAdmin = u.role === "INTERNAL_ADMIN";
            return (
              <li
                key={u.id}
                className="grid grid-cols-2 gap-x-3 gap-y-1 px-4 py-2 text-sm sm:grid-cols-[1.2fr_1fr_0.9fr_1fr_0.6fr_0.8fr_1fr_1fr_1.6fr] sm:items-center"
              >
                <span className="font-medium text-gray-900">
                  {u.username}
                  {isSelf && (
                    <span className="ml-1 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">
                      当前账号
                    </span>
                  )}
                  {isAdmin && (
                    <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                      超级管理员
                    </span>
                  )}
                </span>
                <span className="text-gray-700">{u.display_name}</span>
                <span className="text-gray-700">{ROLE_LABELS[u.role] ?? u.role}</span>
                <span className="text-gray-600">{u.company_name ?? "—"}</span>
                <span>
                  {u.is_active ? (
                    <span className="text-emerald-600">已启用</span>
                  ) : (
                    <span className="text-red-600">已停用</span>
                  )}
                </span>
                <span className="text-gray-600">
                  {u.must_change_password ? "待首次改密" : "密码已修改"}
                </span>
                <span className="text-gray-500">{fmt(u.last_login_at)}</span>
                <span className="text-gray-500">{fmt(u.created_at)}</span>
                <span className="flex flex-wrap gap-2">
                  {!isAdmin && (
                    <>
                      <button
                        type="button"
                        disabled={pendingId === u.id}
                        onClick={() => handleReset(u.id)}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                      >
                        重置密码
                      </button>
                      {u.is_active ? (
                        <button
                          type="button"
                          disabled={pendingId === u.id}
                          onClick={() => handleDeactivate(u.id)}
                          className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          停用
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={pendingId === u.id}
                          onClick={() => handleActivate(u.id)}
                          className="rounded-md border border-emerald-200 px-2 py-1 text-xs text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                        >
                          启用
                        </button>
                      )}
                    </>
                  )}
                </span>
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-gray-400">没有符合条件的账号</li>
          )}
        </ul>
      </section>
    </div>
  );
}
