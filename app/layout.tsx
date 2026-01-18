import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PARARIA AI（仮）",
  description: "学習塾向けの会話ログ解析ダッシュボード",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
