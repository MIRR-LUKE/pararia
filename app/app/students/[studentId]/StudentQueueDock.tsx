"use client";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { ReportItem, SessionItem } from "./roomTypes";
import styles from "./studentWorkbench.module.css";

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
  const processingSessions = sessions.filter((session) => session.status === "PROCESSING");
  const collectingSession = sessions.find((session) => session.status === "COLLECTING");
  const readyProof = sessions.find((session) => session.conversation?.id && session.status === "READY");
  const pendingEntities = sessions.reduce((acc, session) => acc + session.pendingEntityCount, 0);
  const latestDraftReport = reports.find((report) => report.status !== "SENT") ?? null;

  if (collectingSession) {
    items.push({
      id: `collecting-${collectingSession.id}`,
      label: "check-out 待ち",
      detail: "授業前のチェックインまで完了しています。授業後の録音で 1 コマ分の指導報告が完成します。",
      tone: "medium",
      actionLabel: "チェックアウトを始める",
      onAction: () => onOpenRecording("LESSON_REPORT", "CHECK_OUT"),
    });
  }

  if (processingSessions.length > 0) {
    items.push({
      id: "processing",
      label: "生成中",
      detail: `${processingSessions.length} 件のセッションで文字起こしまたは要約処理が進行中です。`,
      tone: "neutral",
      actionLabel: "進行を見る",
      onAction: () => onOpenRecording(processingSessions[0]?.type === "LESSON_REPORT" ? "LESSON_REPORT" : "INTERVIEW"),
    });
  }

  if (pendingEntities > 0 && readyProof?.conversation?.id) {
    items.push({
      id: "entities",
      label: "entity 確認",
      detail: `${pendingEntities} 件の固有名詞候補があります。送付前にここだけ確認すれば事故を止められます。`,
      tone: "high",
      actionLabel: "根拠を見る",
      onAction: () => onOpenProof(readyProof.conversation!.id),
    });
  }

  if (latestDraftReport) {
    items.push({
      id: `report-${latestDraftReport.id}`,
      label: "レポ確認待ち",
      detail: "下書きはできています。送付前の確認だけをこの場で終えられます。",
      tone: "medium",
      actionLabel: "レポを確認",
      onAction: onOpenReport,
    });
  }

  if (items.length === 0) {
    items.push({
      id: "clear",
      label: "待ちなし",
      detail: "この生徒について、今すぐ止めるべき確認待ちはありません。必要ならここから面談か授業を始められます。",
      tone: "low",
      actionLabel: "面談を始める",
      onAction: () => onOpenRecording("INTERVIEW"),
    });
  }

  return (
    <section className={styles.queueDock} aria-label="生徒ごとの進行状況">
      <div className={styles.queueDockHeader}>
        <div>
          <div className={styles.eyebrow}>Student Queue</div>
          <h3 className={styles.workbenchTitle}>この生徒で今止めないこと</h3>
        </div>
        <Badge label={`${items.length} 件`} tone={items.some((item) => item.tone === "high") ? "high" : "neutral"} />
      </div>

      <div className={styles.queueList}>
        {items.map((item) => (
          <div key={item.id} className={styles.queueItem}>
            <div className={styles.queueItemHead}>
              <strong>{item.label}</strong>
              <Badge label={item.label} tone={item.tone} />
            </div>
            <p className={styles.mutedText}>{item.detail}</p>
            <Button size="small" variant={item.tone === "high" ? "primary" : "secondary"} onClick={item.onAction}>
              {item.actionLabel}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}