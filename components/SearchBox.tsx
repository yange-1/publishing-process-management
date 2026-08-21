"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SearchBox({ defaultValue = "" }: { defaultValue?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(defaultValue);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    router.push(`/search?q=${encodeURIComponent(q.trim())}`);
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="搜索书稿"
        placeholder="请输入书名或责任编辑"
        className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400"
      />
      <button
        type="submit"
        className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        搜索
      </button>
    </form>
  );
}
