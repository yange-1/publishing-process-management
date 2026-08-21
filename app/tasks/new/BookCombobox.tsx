"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { STAGE_LABELS } from "@/lib/dashboard-service";
import type { BookNextStageInfo } from "@/lib/task-service";

function fmt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function BookCombobox({
  books,
  value,
  onChange,
}: {
  books: BookNextStageInfo[];
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const initial = books.find((b) => b.bookId === value) ?? null;
  const [query, setQuery] = useState(initial ? initial.title : "");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return books;
    return books.filter((b) => b.title.toLowerCase().includes(q));
  }, [books, query]);

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  function select(b: BookNextStageInfo) {
    onChange(b.bookId);
    setQuery(b.title);
    setOpen(false);
  }

  function clear() {
    onChange(null);
    setQuery("");
    setOpen(true);
    setHighlight(0);
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => setOpen(true)}
        placeholder="搜索书稿书名"
        className="w-full rounded-md border border-gray-300 px-3 py-2 pr-8 text-sm"
      />
      {value != null && (
        <button
          type="button"
          onClick={clear}
          aria-label="清除选择"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          ✕
        </button>
      )}
      {open && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-400">没有符合条件的书稿</li>
          ) : (
            filtered.map((b, i) => (
              <li key={b.bookId}>
                <button
                  type="button"
                  onClick={() => select(b)}
                  onMouseEnter={() => setHighlight(i)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                    i === highlight ? "bg-blue-50" : ""
                  }`}
                >
                  <span className="text-gray-800">{b.title}</span>
                  <span className="text-xs text-gray-400">
                    {b.latestCompletedStage
                      ? STAGE_LABELS[b.latestCompletedStage] ?? b.latestCompletedStage
                      : ""}
                    {b.latestCompletedAt ? ` · ${fmt(b.latestCompletedAt)}` : ""}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
