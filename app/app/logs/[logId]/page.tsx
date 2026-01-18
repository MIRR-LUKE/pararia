"use client";

import { AppHeader } from "@/components/layout/AppHeader";
import { LogDetailView } from "../LogDetailView";

export default function LogDetailPage({ params }: { params: { logId: string } }) {
  return (
    <div>
      <AppHeader title="会話ログ詳細" subtitle="元テキスト・AI要約・タグ・講師メモを確認" />
      <LogDetailView logId={params.logId} />
    </div>
  );
}
