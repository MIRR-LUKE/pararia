"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatePanel } from "@/components/ui/StatePanel";
import { StatStrip } from "@/components/ui/StatStrip";
import type { LogListPageData } from "@/lib/logs/get-log-list-page-data";
import {
  transcriptReviewStateLabel,
  transcriptReviewSummary,
  transcriptReviewTone,
} from "@/lib/logs/transcript-review-display";
import DeleteLogButton from "./DeleteLogButton";
import styles from "./logsList.module.css";

type Props = {
  studentId: string | null;
};

function sessionTypeLabel() {
  return "面談";
}

function statusLabel(status: string) {
  if (status === "DONE") return "生成完了";
  if (status === "PROCESSING") return "生成中";
  if (status === "ERROR") return "エラー";
  return "処理中";
}

function statusTone(status: string): "neutral" | "low" | "medium" | "high" {
  if (status === "DONE") return "low";
  if (status === "ERROR") return "high";
  if (status === "PROCESSING") return "medium";
  return "neutral";
}

function excerpt(markdown?: string | null) {
  if (!markdown) return "まだ要約はありません。録音が終わると、ここに要点が出ます。";
  const lines = markdown
    .replace(/\r/g, "")
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^#{1,6}\s+/, "")
        .replace(/^■\s+/, "")
        .replace(/^\*\*([^*]+)\*\*:\s*/, "")
    )
    .filter(Boolean)
    .filter(
      (line) =>
        !/^(対象生徒|面談日|面談時間|担当チューター|面談目的|指導日|教科・単元|対象期間|作成日):/.test(line)
    );
  const candidate = lines.find((line) => !/^[•・\-*]\s+/.test(line)) ?? lines[0] ?? "";
  return candidate.replace(/^[•・\-*]\s+/, "").replace(/\*\*/g, "").trim().slice(0, 140);
}

function LogsListFallback() {
  return (
    <Card
      title="保存済みログ"
      subtitle="面談ログを一覧し、どの保護者レポートに使われたかを確認できます。"
    >
      <StatePanel
        kind="processing"
        title="ログ一覧を開いています..."
        subtitle="ログ本文と source trace を整えています。"
      />
    </Card>
  );
}

export default function LogsListClient({ studentId }: Props) {
  const [data, setData] = useState<LogListPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = studentId ? `?studentId=${encodeURIComponent(studentId)}` : "";
      const response = await fetch(`/api/logs${query}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error ?? "ログ一覧の取得に失敗しました。");
      }
      setData(body as LogListPageData);
    } catch (nextError: any) {
      setError(nextError?.message ?? "ログ一覧の取得に失敗しました。");
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logs = data?.conversations ?? [];

  if (loading && !data) {
    return <LogsListFallback />;
  }

  if (error && !data) {
    return (
      <Card
        title="保存済みログ"
        subtitle="面談ログを一覧し、どの保護者レポートに使われたかを確認できます。"
      >
        <StatePanel
          kind="error"
          title="ログ一覧を更新できませんでした"
          subtitle={error}
          action={
            <Button variant="secondary" onClick={() => void refresh()}>
              もう一度読む
            </Button>
          }
        />
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  const summaryItems = [
    { label: "面談", value: data.counts.interview },
  ];

  return (
    <>
      <StatStrip items={summaryItems} />

      <Card
        title="保存済みログ"
        subtitle="面談ログを一覧し、どの保護者レポートに使われたかを確認できます。"
      >
        {logs.length === 0 ? (
          <StatePanel
            kind="empty"
            title="まだ面談ログはありません"
            subtitle="録音後にログを生成すると、ここに表示されます。"
          />
        ) : (
          <div className={styles.list}>
            {logs.map((log) => {
              const trustSummary = transcriptReviewSummary(log.transcriptReview);
              return (
                <article key={log.id} className={styles.row}>
                  <Link href={`/app/logs/${log.id}`} className={styles.rowLink} prefetch={false}>
                    <div className={styles.rowMain}>
                      <div className={styles.rowTop}>
                        <div>
                          <div className={styles.studentName}>{log.student?.name ?? "担当未設定"}</div>
                          <div className={styles.meta}>{log.student?.grade ?? "学年未設定"}</div>
                        </div>
                        <div className={styles.badgeRow}>
                          <Badge label={sessionTypeLabel()} tone="neutral" />
                          <Badge label={statusLabel(log.status)} tone={statusTone(log.status)} />
                          <Badge
                            label={transcriptReviewStateLabel(log.reviewState)}
                            tone={transcriptReviewTone(log.reviewState, log.transcriptReview)}
                          />
                        </div>
                      </div>

                      <p className={styles.summary}>{excerpt(log.summaryMarkdown)}</p>
                      <div className={styles.trustRow}>
                        <span className={styles.trustLabel}>信頼判断</span>
                        <span className={styles.trustSummary}>{trustSummary}</span>
                      </div>

                      <p className={styles.traceEmpty}>source trace の詳細はログ詳細で確認できます。</p>

                      <div className={styles.footerRow}>
                        <span className={styles.meta}>{log.date}</span>
                        <span className={styles.linkLabel}>開く</span>
                      </div>
                    </div>
                  </Link>

                  <div className={styles.rowActions}>
                    <DeleteLogButton
                      logId={log.id}
                      title={`${sessionTypeLabel()}ログを削除しますか？`}
                      onDeleted={refresh}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}
