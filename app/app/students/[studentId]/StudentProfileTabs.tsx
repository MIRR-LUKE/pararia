"use client";

import { Card } from "@/components/ui/Card";
import { StudentData } from "@/lib/mockData";

/**
 * v0.2 では縦統合レイアウトに刷新されたため、このコンポーネントは非推奨です。
 * 互換性維持のため簡易スタブのみ提供します。
 */
export function StudentProfileTabs({ student }: { student: StudentData }) {
  return (
    <Card title="v0.2 新レイアウトを利用してください">
      <p style={{ margin: 0, color: "var(--muted)" }}>
        {student.name} の詳細は新しい縦型レイアウトに統合されています。
        `/app/students/[studentId]` をご確認ください。
      </p>
    </Card>
  );
}


