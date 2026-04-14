"use client";

import { Button } from "@/components/ui/Button";
import type { ReportItem, SessionItem } from "./roomTypes";
import { formatSessionLabel } from "./studentDetailFormatting";
import styles from "./studentDetail.module.css";

type Props = {
  sessions: SessionItem[];
  reports: ReportItem[];
  onOpenLog: (logId: string) => void;
  onOpenTranscriptReview: (logId: string) => void;
  onOpenParentReport: (reportId: string) => void;
  onOpenReportStudioSend: () => void;
};

type QueueCard = {
  title: string;
  count: number;
  description: string;
  ctaLabel: string;
  tone: "attention" | "warning" | "neutral";
  onClick?: () => void;
};

function firstConversationId(session?: SessionItem | null) {
  return session?.conversation?.id ?? null;
}

export function StudentDetailActionQueue({
  sessions,
  reports,
  onOpenLog,
  onOpenTranscriptReview,
  onOpenParentReport,
  onOpenReportStudioSend,
}: Props) {
  const reviewSessions = sessions.filter(
    (session) => session.type === "INTERVIEW" && session.conversation?.reviewState === "REQUIRED"
  );
  const readyButUnreviewedSessions = sessions.filter(
    (session) =>
      session.type === "INTERVIEW" &&
      session.conversation?.id &&
      session.conversation?.status === "DONE" &&
      session.conversation?.reviewState !== "REQUIRED"
  );
  const shareReports = reports.filter((report) => report.needsReview || report.needsShare);
  const activeGenerationSessions = sessions.filter(
    (session) =>
      session.type === "INTERVIEW" &&
      (
      ["TRANSCRIBING", "GENERATING"].includes(session.status) ||
      ["QUEUED", "GENERATING"].includes(session.nextMeetingMemo?.status ?? "")
      )
  );

  const cards: QueueCard[] = [
    {
      title: "先に確認したい文字起こし",
      count: reviewSessions.length,
      description:
        reviewSessions.length > 0
          ? `${formatSessionLabel(reviewSessions[0])} から順に固有名詞と transcript を確認します。`
          : readyButUnreviewedSessions.length > 0
            ? "要確認の transcript はありません。次はログ本文と共有判断を見に行けます。"
            : "まだ確認に回す transcript はありません。",
      ctaLabel: reviewSessions.length > 0 ? "文字起こしを確認する" : "ログを見る",
      tone: reviewSessions.length > 0 ? "attention" : "neutral",
      onClick:
        reviewSessions.length > 0
          ? () => {
              const logId = firstConversationId(reviewSessions[0]);
              if (logId) onOpenTranscriptReview(logId);
            }
          : readyButUnreviewedSessions.length > 0
            ? () => {
                const logId = firstConversationId(readyButUnreviewedSessions[0]);
                if (logId) onOpenLog(logId);
              }
            : undefined,
    },
    {
      title: "送付前に止まっているレポート",
      count: shareReports.length,
      description:
        shareReports.length > 0
          ? `${shareReports[0].deliveryStateLabel ?? shareReports[0].workflowStatusLabel ?? "状態確認中"} のレポートがあります。共有前の最終確認を進めます。`
          : "共有待ちや再送確認が必要なレポートはありません。",
      ctaLabel: shareReports.length > 0 ? "送付前確認へ進む" : "直近のレポートを見る",
      tone: shareReports.length > 0 ? "warning" : "neutral",
      onClick:
        shareReports.length > 0
          ? onOpenReportStudioSend
          : reports[0]
            ? () => onOpenParentReport(reports[0].id)
            : undefined,
    },
    {
      title: "いま裏で進んでいる処理",
      count: activeGenerationSessions.length,
      description:
        activeGenerationSessions.length > 0
          ? `${formatSessionLabel(activeGenerationSessions[0])} の生成が進行中です。途中で閉じても大丈夫です。`
          : "いま進行中の生成はありません。",
      ctaLabel: activeGenerationSessions.length > 0 ? "最新の進行を見る" : "次の面談に進む",
      tone: activeGenerationSessions.length > 0 ? "attention" : "neutral",
      onClick:
        activeGenerationSessions.length > 0
          ? () => {
              const logId = firstConversationId(activeGenerationSessions[0]);
              if (logId) onOpenLog(logId);
            }
          : undefined,
    },
  ];

  return (
    <section className={styles.actionQueueSection} aria-label="次に確認したいこと">
      <div className={styles.actionQueueHeader}>
        <div className={styles.cardTitle}>次にやること</div>
        <div className={styles.cardSubtext}>録音だけで終わらず、確認と共有まで同じ画面で進められるようにしています。</div>
      </div>
      <div className={styles.actionQueueGrid}>
        {cards.map((card) => (
          <div
            key={card.title}
            className={`${styles.actionQueueCard} ${
              card.tone === "attention"
                ? styles.actionQueueCardAttention
                : card.tone === "warning"
                  ? styles.actionQueueCardWarning
                  : ""
            }`}
          >
            <div className={styles.actionQueueMeta}>
              <span className={styles.actionQueueLabel}>{card.title}</span>
              <strong className={styles.actionQueueCount}>{card.count}件</strong>
            </div>
            <p className={styles.actionQueueDescription}>{card.description}</p>
            <Button variant="secondary" onClick={card.onClick} disabled={!card.onClick}>
              {card.ctaLabel}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
