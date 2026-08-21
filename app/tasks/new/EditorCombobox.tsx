"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  filterEditorsByQuery,
  editorSelectionClearsOn,
  type EditorOption,
} from "@/lib/task-service";

export default function EditorCombobox({
  editors,
  value,
  onChange,
  placeholder = "搜索责任编辑姓名或登录账号",
  emptyText = "没有匹配的责任编辑",
}: {
  editors: EditorOption[];
  value: number | null;
  onChange: (id: number | null) => void;
  placeholder?: string;
  emptyText?: string;
}) {
  const initialSelected = editors.find((e) => e.id === value) ?? null;
  const [query, setQuery] = useState(
    initialSelected ? initialSelected.display_name : "",
  );
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = editors.find((e) => e.id === value) ?? null;

  const filtered = useMemo(() => {
    // 已选中且未改动输入时，展开显示全部，便于切换
    if (selected && query === selected.display_name) return editors;
    return filterEditorsByQuery(editors, query);
  }, [editors, query, selected]);

  // 点击组件外部时关闭下拉
  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  function openDropdown() {
    setOpen(true);
    const idx = selected
      ? filtered.findIndex((e) => e.id === selected.id)
      : -1;
    setHighlight(idx >= 0 ? idx : 0);
  }

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const text = e.target.value;
    setQuery(text);
    setOpen(true);
    setHighlight(0);
    if (editorSelectionClearsOn(selected?.display_name ?? null, text)) {
      onChange(null); // 修改文字即清除旧选择，防止显示名与实际 ID 不一致
    }
  }

  function select(editor: EditorOption) {
    onChange(editor.id);
    setQuery(editor.display_name);
    setOpen(false);
  }

  function clear() {
    onChange(null);
    setQuery("");
    setOpen(true);
    setHighlight(0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = filtered[highlight];
      if (target) select(target);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={handleInput}
          onFocus={openDropdown}
          onClick={openDropdown}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full rounded-md border border-gray-300 px-3 py-2 pr-16 text-sm"
        />
        <div className="absolute inset-y-0 right-0 flex items-center pr-1">
          {selected && (
            <button
              type="button"
              onClick={clear}
              aria-label="清除选择"
              className="px-1.5 text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          )}
          <button
            type="button"
            onClick={() => (open ? setOpen(false) : openDropdown())}
            aria-label="展开责任编辑列表"
            className="px-1.5 text-gray-400 hover:text-gray-600"
          >
            ▾
          </button>
        </div>
      </div>

      {open && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-400">{emptyText}</li>
          ) : (
            filtered.map((editor, i) => (
              <li key={editor.id}>
                <button
                  type="button"
                  onClick={() => select(editor)}
                  onMouseEnter={() => setHighlight(i)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                    i === highlight ? "bg-blue-50" : ""
                  }`}
                >
                  <span className="text-gray-800">{editor.display_name}</span>
                  <span className="text-xs text-gray-400">
                    {editor.username}
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
