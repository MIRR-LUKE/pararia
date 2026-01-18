"use client";

import { LogDetailView } from "@/app/app/logs/LogDetailView";

export default function StudentLogDetail({
  params,
}: {
  params: { studentId: string; logId: string };
}) {
  return (
    <div style={{ marginTop: 8 }}>
      <LogDetailView logId={params.logId} showHeader={false} />
    </div>
  );
}
