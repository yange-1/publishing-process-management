import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "出版校对流程管理平台",
  description: "出版校对流程管理平台 —— 校对进度看板与滞留预警",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
