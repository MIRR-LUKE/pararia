"use client";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { ReportItem, SessionItem } from "./roomTypes";
import styles from "./studentDetail.module.css";

type Props = {
  sessions: SessionItem[];
  reports: ReportItem[];
  onOpenProof: (logId: string) => void;
  onOpenReport: () => void;
  onOpenRecording: (mode: "INTERVIEW" | "LESSON_REPORT", part?: "CHECK_IN" | "CHECK_OUT") => void;
};

type QueueItem = {
  id: string;
  label: string;
  detail: string;
  tone: "neutral" | "low" | "medium" | "high";
  actionLabel: string;
  onAction: () => void;
};

export function StudentQueueDock({ sessions, reports, onOpenProof, onOpenReport, onOpenRecording }: Props) {
  const items: QueueItem[] = [];
  const collectingSession = sessions.find((session) => session.status === "COLLECTING");
  const processingSession = sessions.find((session) => session.status === "PROCESSING");
  const proofSession = sessions.find((session) => session.pendingEntityCount > 0 && session.conversation?.id);
  const draftReport = reports.find((report) => report.status !== "SENT");

  if (collectingSession) {
    items.push({
      id: `collecting-${collectingSession.id}`,
      label: "授業後の記録待ち",
      detail: "授業前だけ保存されています。授業後を追加すると指導報告がまとまります。",
      tone: "medium",
      actionLabel: "チェックアウトを始める",
      onAction: () => onOpenRecording("LESSON_REPORT", "CHECK_OUT"),
    });
  }

  if (processingSession) {
    items.push({
      id: `processing-${processingSession.id}`,
      label: "生成中",
      detail: "文字起こしと要点整理が進行中です。完了後はそのまま詳細で確認できます。",
      tone: "neutral",
      actionLabel: "生成結果を見る",
      onAction: () => {
        if (processingSession.conversation?.id) onOpenProof(processingSession.conversation.id);
      },
    });
  }

  if (proofSession?.conversation?.id) {
    items.push({
      id: `entity-${proofSession.id}`,
      label: "固有名詞の確認",
      detail: `${proofSession.pendingEntityCount} 件の固有名詞が未確認です。送付前にここを先に整えます。`,
      tone: "high",
      actionLabel: "根拠を見る",
      onAction: () => onOpenProof(proofSession.conversation!.id),
    });
  }

  if (draftReport) {
    items.push({
      id: `report-${draftReport.id}`,
      label: "今月の保護者レポート",
      detail: "下書きがあります。内容と未確認項目を見てから送付前確認に進めます。",
      tone: "medium",
      actionLabel: "送付前確認",
      onAction: onOpenReport,
    });
  }

  if (items.length === 0) return null;

  return (
    <div className={styles.queueStrip}>
      {items.map((item) => (
        <div key={item.id} className={styles.queueItemCompact}>
          <div className={styles.queueItemHeadCompact}>
            <Badge label={item.label} tone={item.tone} />
            <Button size="small" variant={item.tone === "high" ? "primary" : "secondary"} onClick={item.onAction}>
              {item.actionLabel}
            </Button>
          </div>
          <p>{item.detail}</p>
        </div>
      ))}
    </div>
  );
}
