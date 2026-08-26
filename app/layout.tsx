import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "校了么",
  description: "书稿校对任务与返稿配送管理系统",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
