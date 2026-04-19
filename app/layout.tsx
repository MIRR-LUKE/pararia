import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { TelemetryBridge } from "./observability/TelemetryBridge";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "PARARIA AI",
    template: "%s | PARARIA AI",
  },
  description: "面談ログを次の会話と保護者共有に変える Teaching OS SaaS",
  applicationName: "PARARIA Teacher App",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "PARARIA Teacher App",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark",
  themeColor: "#171717",
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
