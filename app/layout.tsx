import { Suspense } from "react";
import type { Metadata } from "next";
import { TelemetryBridge } from "./observability/TelemetryBridge";
import "./globals.css";

export const metadata: Metadata = {
  title: "PARARIA AI",
  description: "面談と指導報告を次の会話と保護者共有に変える Teaching OS SaaS",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body>
        <Suspense fallback={null}>
          <TelemetryBridge />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
