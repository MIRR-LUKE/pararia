"use client";

import { Card } from "@/components/ui/Card";
import { conversationLogs } from "@/lib/mockData";

/**
 * v0.2 では会話ログ表示をページ内に統合したためこのコンポーネントは非推奨です。
 */
export function StudentTabs({
  studentId,
}: {
  logs: typeof conversationLogs;
  studentId: string;
}) {
  return (
    <Card title="会話ログは新UIに統合されています">
      <p style={{ margin: 0, color: "var(--muted)" }}>
        `/app/students/{studentId}` の会話ログセクションをご利用ください。
      </p>
    </Card>
  );
}
