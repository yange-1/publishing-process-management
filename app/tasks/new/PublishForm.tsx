"use client";

import { useState } from "react";
import Link from "next/link";
import { publishTaskAction, type PublishActionResult } from "./actions";
import EditorCombobox from "./EditorCombobox";
import BookCombobox from "./BookCombobox";
import type {
  ExternalCompanyOption,
  BookNextStageInfo,
  EditorOption,
} from "@/lib/task-service";
import { STAGE_LABELS, WORK_TYPE_LABELS } from "@/lib/dashboard-service";

const STAGE_OPTIONS = [
  { value: "INITIAL_REVIEW", label: "初审" },
  { value: "FIRST_PROOF", label: "一校" },
  { value: "SECOND_PROOF", label: "二校" },
  { value: "THIRD_PROOF", label: "三校" },
  { value: "ADDITIONAL_PROOF", label: "加校" },
];

const WORK_TYPE_OPTIONS = [
  { value: "PROOFREAD", label: "读校" },
  { value: "RED_CHECK", label: "核红" },
  { value: "PROOFREAD_AND_RED_CHECK", label: "读校且核红" },
];

const STAR_OPTIONS = [
  { value: 1, label: "一星 · 普通" },
  { value: 2, label: "二星 · 重要" },
  { value: 3, label: "三星 · 重点/评奖/紧急" },
];

const STAR_LABELS = Object.fromEntries(STAR_OPTIONS.map((o) => [o.value, o.label]));

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function PublishForm({
  isAdmin,
  externalCompanies,
  books,
  editors,
}: {
  isAdmin: boolean;
  externalCompanies: ExternalCompanyOption[];
  books: BookNextStageInfo[];
  editors: EditorOption[];
}) {
  const [bookMode, setBookMode] = useState<"new" | "existing">("new");
  const [title, setTitle] = useState("");
  const [bookId, setBookId] = useState<number | null>(null);
  const [stage, setStage] = useState("INITIAL_REVIEW");
  const [workType, setWorkType] = useState("PROOFREAD");
  const [starLevel, setStarLevel] = useState(1);
  const [companyId, setCompanyId] = useState<string>(() =>
    externalCompanies.length === 1 ? String(externalCompanies[0].id) : "",
  );
  const [note, setNote] = useState("");
  const [editorId, setEditorId] = useState<number | null>(() =>
    editors.length === 1 ? editors[0].id : null,
  );
  const [editorKey, setEditorKey] = useState(0);
  const [proxyReason, setProxyReason] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<PublishActionResult, { ok: true }> | null>(null);

  const selectedBook = bookId != null ? books.find((b) => b.bookId === bookId) : undefined;
  const eligibleBooks =
    isAdmin && bookMode === "existing" && editorId != null
      ? books.filter((b) => b.editorId === editorId)
      : books;

  function handleBookSelect(id: number | null) {
    setBookId(id);
    if (id != null) {
      const b = books.find((x) => x.bookId === id);
      if (b) {
        if (b.latestStarLevel != null) setStarLevel(b.latestStarLevel);
        if (b.companyId != null) setCompanyId(String(b.companyId));
      }
    }
  }

  function resetForm() {
    setResult(null);
    setError(null);
    setBookMode("new");
    setTitle("");
    setBookId(null);
    setNote("");
    setStage("INITIAL_REVIEW");
    setWorkType("PROOFREAD");
    setStarLevel(1);
    setCompanyId(externalCompanies.length === 1 ? String(externalCompanies[0].id) : "");
    setEditorId(editors.length === 1 ? editors[0].id : null);
    setEditorKey((k) => k + 1);
    setProxyReason("");
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (bookMode === "new" && !title.trim()) {
      setError("请填写书名");
      return;
    }
    if (bookMode === "existing" && bookId == null) {
      setError("请选择已有书稿");
      return;
    }
    if (!companyId) {
      setError("请选择接收外校公司");
      return;
    }
    if (isAdmin && bookMode === "new" && editorId == null) {
      setError("请从列表中选择一名有效的责任编辑");
      return;
    }
    if (isAdmin && bookMode === "existing" && editorId == null) {
      setError("请选择目标责任编辑");
      return;
    }
    if (isAdmin && !proxyReason.trim()) {
      setError("请填写代发布原因");
      return;
    }

    setSubmitting(true);
    const res = await publishTaskAction({
      bookMode,
      bookId: bookMode === "existing" ? bookId ?? undefined : undefined,
      bookTitle: bookMode === "new" ? title : undefined,
      stage: bookMode === "existing" ? selectedBook?.nextStage ?? "" : stage,
      starLevel,
      workType,
      companyId: Number(companyId),
      note: note.trim() || undefined,
      editorId: isAdmin && bookMode === "new" ? Number(editorId) : undefined,
      proxyReason: isAdmin ? proxyReason.trim() : undefined,
    });
    setSubmitting(false);

    if (res.ok) {
      setResult(res);
    } else {
      setError(res.message);
    }
  }

  if (result) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
          <h2 className="mb-3 text-lg font-semibold text-emerald-800">发布成功</h2>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-gray-500">书名</dt>
              <dd className="text-gray-900">{result.title}</dd>
            </div>
            <div>
              <dt className="text-gray-500">校次</dt>
              <dd className="text-gray-900">{STAGE_LABELS[result.stage] ?? result.stage}</dd>
            </div>
            <div>
              <dt className="text-gray-500">工作内容</dt>
              <dd className="text-gray-900">{WORK_TYPE_LABELS[result.workType] ?? "读校"}</dd>
            </div>
            <div>
              <dt className="text-gray-500">星级</dt>
              <dd className="text-gray-900">{STAR_LABELS[result.starLevel] ?? result.starLevel}</dd>
            </div>
            <div>
              <dt className="text-gray-500">责任编辑</dt>
              <dd className="text-gray-900">{result.editorName}</dd>
            </div>
            <div>
              <dt className="text-gray-500">接收外校公司</dt>
              <dd className="text-gray-900">{result.companyName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-gray-500">当前状态</dt>
              <dd className="text-gray-900">待确认收稿</dd>
            </div>
            <div>
              <dt className="text-gray-500">发布时间</dt>
              <dd className="text-gray-900">{fmt(result.publishedAt)}</dd>
            </div>
          </dl>
        </div>
        <div className="flex gap-3">
          <Link
            href="/"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            返回首页
          </Link>
          <button
            type="button"
            onClick={resetForm}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            继续发布下一项
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 书稿选择方式 */}
      <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-gray-900">书稿</h2>
        <div className="mb-3 flex gap-3">
          {(["new", "existing"] as const).map((mode) => (
            <label key={mode} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="bookMode"
                checked={bookMode === mode}
                onChange={() => setBookMode(mode)}
              />
              {mode === "new" ? "新书稿" : "已有书稿继续发起下一校次"}
            </label>
          ))}
        </div>

        {bookMode === "new" ? (
          <div>
            <label className="mb-1 block text-sm text-gray-600">书名</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="请输入书名"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        ) : (
          <div className="space-y-2">
            <div>
              <label className="mb-1 block text-sm text-gray-600">选择已有书稿</label>
              <BookCombobox books={eligibleBooks} value={bookId} onChange={handleBookSelect} />
            </div>
            {selectedBook && (
              <div className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">
                书名：{selectedBook.title}
                <span className="mx-2">·</span>
                责任编辑：{selectedBook.editorName ?? "—"}
                <span className="mx-2">·</span>
                上一校次：
                {selectedBook.latestCompletedStage
                  ? STAGE_LABELS[selectedBook.latestCompletedStage] ?? selectedBook.latestCompletedStage
                  : "—"}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 校次与星级 */}
      <section className="grid grid-cols-1 gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-2">
        {bookMode === "new" ? (
          <div>
            <label className="mb-1 block text-sm text-gray-600">校次</label>
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              {STAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <span className="mb-1 block text-sm text-gray-600">下一校次（系统自动确定）</span>
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
              {selectedBook?.nextStage
                ? STAGE_LABELS[selectedBook.nextStage] ?? selectedBook.nextStage
                : "请先选择书稿"}
            </div>
          </div>
        )}
        <div>
          <label className="mb-1 block text-sm text-gray-600">重要程度</label>
          <select
            value={starLevel}
            onChange={(e) => setStarLevel(Number(e.target.value))}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            {STAR_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* 本次工作内容 */}
      <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <label className="mb-2 block text-sm text-gray-600">本次工作内容</label>
        <div className="flex gap-4">
          {WORK_TYPE_OPTIONS.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="workType"
                checked={workType === o.value}
                onChange={() => setWorkType(o.value)}
              />
              {o.label}
            </label>
          ))}
        </div>
      </section>

      {/* 接收外校公司 */}
      <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <label className="mb-1 block text-sm text-gray-600">接收外校公司</label>
        {externalCompanies.length <= 1 ? (
          <div className="text-sm text-gray-700">
            {externalCompanies.length === 1 ? externalCompanies[0].name : "暂无启用的外校公司"}
          </div>
        ) : (
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">请选择外校公司</option>
            {externalCompanies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </section>

      {/* 备注 */}
      <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <label className="mb-1 block text-sm text-gray-600">备注（可选）</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          rows={3}
          placeholder="特殊要求说明，最多 200 字"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <div className="mt-1 text-right text-xs text-gray-400">{note.length}/200</div>
      </section>

      {/* 管理员代发布 */}
      {isAdmin && (
        <section className="space-y-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-base font-semibold text-amber-800">代发布（Dominance）</h2>
          {bookMode === "new" ? (
            <div>
              <label className="mb-1 block text-sm text-gray-600">目标责任编辑</label>
              <EditorCombobox
                key={editorKey}
                editors={editors}
                value={editorId}
                onChange={setEditorId}
              />
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-sm text-gray-600">目标责任编辑（用于筛选其书稿）</label>
              <EditorCombobox
                key={editorKey}
                editors={editors}
                value={editorId}
                onChange={setEditorId}
              />
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm text-gray-600">代发布原因</label>
            <textarea
              value={proxyReason}
              onChange={(e) => setProxyReason(e.target.value)}
              maxLength={200}
              rows={2}
              placeholder="请填写代发布原因，最多 200 字"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <div className="mt-1 text-right text-xs text-gray-400">{proxyReason.length}/200</div>
            <p className="mt-1 text-xs text-amber-700">该原因将记录到审计日志。</p>
          </div>
        </section>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {submitting ? "正在发布…" : "发布校对任务"}
      </button>
    </form>
  );
}
