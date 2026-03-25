"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StructuredMarkdown } from "@/components/ui/StructuredMarkdown";
import styles from "./[logId]/logDetail.module.css";

type ConversationStatus = "PROCESSING" | "PARTIAL" | "DONE" | "ERROR";
type TabKey = "summary" | "transcript";

type ConversationLog = {
  id: string;
  status: ConversationStatus;
  summaryMarkdown?: string | null;
  operationalSummaryMarkdown?: string | null;
  formattedTranscript?: string | null;
  rawTextOriginal?: string | null;
  rawTextCleaned?: string | null;
  student?: { name: string; grade?: string | null } | null;
  session?: { type: string; status: string } | null;
};

type Props = {
  logId: string;
  showHeader?: boolean;
  onBack?: () => void;
};

const TAB_LABELS: Array<{ key: TabKey; label: string }> = [
  { key: "summary", label: "ログ" },
  { key: "transcript", label: "文字起こし" },
];

const STATUS_LABEL: Record<ConversationStatus, string> = {
  PROCESSING: "生成中",
  PARTIAL: "一部完了",
  DONE: "確認可能",
  ERROR: "エラー",
};

function toneFromStatus(status: ConversationStatus): "neutral" | "low" | "medium" | "high" {
  if (status === "DONE") return "low";
  if (status === "ERROR") return "high";
  if (status === "PROCESSING") return "medium";
  return "neutral";
}

function logTitle(type?: string | null) {
  return type === "LESSON_REPORT" ? "指導報告ログ" : "面談ログ";
}

export function LogDetailView({ logId, showHeader = true, onBack }: Props) {
  const [log, setLog] = useState<ConversationLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("summary");

  const fetchLog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${logId}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "ログの取得に失敗しました。");
      setLog(body?.conversation as ConversationLog);
    } catch (nextError: any) {
      setError(nextError?.message ?? "ログの取得に失敗しました。");
      setLog(null);
    } finally {
      setLoading(false);
    }
  }, [logId]);

  useEffect(() => {
    void fetchLog();
  }, [fetchLog]);

  const summaryMarkdown = useMemo(
    () => log?.summaryMarkdown?.trim() || log?.operationalSummaryMarkdown?.trim() || "",
    [log?.operationalSummaryMarkdown, log?.summaryMarkdown]
  );
  const transcriptText = log?.formattedTranscript || log?.rawTextCleaned || log?.rawTextOriginal || "";

  if (loading) {
    return <div className={styles.progressBanner}>ログを読み込んでいます...</div>;
  }

  if (error || !log) {
    return (
      <div className={styles.inlineError}>
        <p>{error ?? "ログを読み込めませんでした。"}</p>
        <div className={styles.inlineActions}>
          <Button variant="secondary" onClick={() => void fetchLog()}>
            もう一度読む
          </Button>
          {onBack ? <Button onClick={onBack}>閉じる</Button> : null}
        </div>
      </div>
    );
  }

  return (
    <section className={styles.page}>
      {showHeader ? (
        <div className={styles.headerRow}>
          <div className={styles.headerMain}>
            <div className={styles.eyebrow}>{logTitle(log.session?.type)}</div>
            <h2 className={styles.title}>{log.student?.name ?? "生徒"}</h2>
            <p className={styles.subtitle}>ログ本文と文字起こしを確認できます。</p>
          </div>
          <div className={styles.headerActions}>
            <Badge label={STATUS_LABEL[log.status]} tone={toneFromStatus(log.status)} />
            {onBack ? <Button variant="secondary" onClick={onBack}>閉じる</Button> : null}
          </div>
        </div>
      ) : null}

      <div className={styles.tabBar}>
        {TAB_LABELS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`${styles.tabButton} ${tab === item.key ? styles.tabActive : ""}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "summary" ? (
        <div className={styles.stack}>
          <div className={styles.markdownBody}>
            <StructuredMarkdown markdown={summaryMarkdown} emptyMessage="まだログ本文は生成されていません。" />
          </div>
        </div>
      ) : null}

      {tab === "transcript" ? (
        <div className={styles.stack}>
          <div className={styles.transcriptBox}>{transcriptText || "まだ文字起こしはありません。"}</div>
        </div>
      ) : null}
    </section>
  );
}
