import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "리플레이 — 나의 자서전",
  description: "구술한 이야기를 그대로의 말맛으로 자서전으로 만들어 드립니다.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
