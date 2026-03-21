"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { buildBundlePreview, buildBundleQualityEval, type ReportBundleLog } from "@/lib/operational-log";
import type { ReportItem, ReportStudioView, SessionItem } from "./roomTypes";
import styles from "./reportStudio.module.css";

type Props = {
  view: ReportStudioView;
  studentId: string;
  studentName: string;
  sessions: SessionItem[];
  reports: ReportItem[];
  selectedSessionIds: string[];
  onSelectedSessionIdsChange: (ids: string[]) => void;
  onRefresh: () => Promise<void> | void;
  onOpenProof: (logId: string) => void;
  onViewChange: (view: ReportStudioView) => void;
};

function toBundleLogs(sessions: SessionItem[]): ReportBundleLog[] {
  return sessions
    .filter((session) => session.conversation?.operationalLog)
    .map((session) => ({
      id: session.id,
      sessionId: session.id,
      date: session.sessionDate,
      mode: session.type,
      operationalLog: session.conversation!.operationalLog!,
    }));
}

function reportStatusLabel(status?: string | null) {
  if (!status) return "未生成";
  if (status === "DRAFT") return "下書き";
  if (status === "REVIEWED") return "確認済み";
  if (status === "SENT") return "送付済み";
  return status;
}

function splitParagraphs(markdown?: string | null) {
  if (!markdown) return [];
  return markdown
    .split(/\n\s*\n/g)
    .map((block) => block.replace(/\r/g, "").trim())
    .filter(Boolean);
}

export function ReportStudio({
  view,
  studentId,
  studentName,
  sessions,
  reports,
  selectedSessionIds,
  onSelectedSessionIdsChange,
  onRefresh,
  onOpenProof,
  onViewChange,
}: Props) {
  const [draftMarkdown, setDraftMarkdown] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const candidateSessions = useMemo(
    () => sessions.filter((session) => session.conversation?.operationalLog),
    [sessions]
  );
  const selectedSessions = useMemo(
    () => candidateSessions.filter((session) => selectedSessionIds.includes(session.id)),
    [candidateSessions, selectedSessionIds]
  );
  const latestReport = reports[0] ?? null;

  useEffect(() => {
    if (!draftMarkdown && latestReport?.reportMarkdown) {
      setDraftMarkdown(latestReport.reportMarkdown);
    }
  }, [draftMarkdown, latestReport?.reportMarkdown]);

  const bundleLogs = useMemo(() => toBundleLogs(selectedSessions), [selectedSessions]);
  const allBundleLogs = useMemo(() => toBundleLogs(candidateSessions), [candidateSessions]);
  const quality = useMemo(() => buildBundleQualityEval(bundleLogs, allBundleLogs), [allBundleLogs, bundleLogs]);
  const previewText = useMemo(() => buildBundlePreview(quality), [quality]);
  const suggestedSessions = useMemo(
    () => candidateSessions.filter((session) => quality.suggestedLogIds.includes(session.id)),
    [candidateSessions, quality.suggestedLogIds]
  );

  const previewParagraphs = splitParagraphs(draftMarkdown || latestReport?.reportMarkdown);

  const generateReport = async () => {
    if (selectedSessionIds.length === 0) return;
    setIsGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/generate-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId,
          sessionIds: selectedSessionIds,
          usePreviousReport: true,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error ?? "保護者レポートの生成に失敗しました。");
      }
      setDraftMarkdown(body?.report?.reportMarkdown ?? "");
      await onRefresh();
      onViewChange("generated");
    } catch (nextError: any) {
      setError(nextError?.message ?? "保護者レポートの生成に失敗しました。");
    } finally {
      setIsGenerating(false);
    }
  };

  const markAsSent = async () => {
    if (!latestReport) return;
    setIsSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${latestReport.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliveryChannel: "manual" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error ?? "送付状態の更新に失敗しました。");
      }
      await onRefresh();
    } catch (nextError: any) {
      setError(nextError?.message ?? "送付状態の更新に失敗しました。");
    } finally {
      setIsSending(false);
    }
  };

  const removeSelectedSession = (sessionId: string) => {
    onSelectedSessionIdsChange(selectedSessionIds.filter((id) => id !== sessionId));
  };

  return (
    <section className={styles.workbenchSection} aria-label="保護者レポート生成">
      <div className={styles.workbenchHeader}>
        <div>
          <div className={styles.eyebrow}>保護者レポート</div>
          <h3 className={styles.workbenchTitle}>
            {view === "selection"
              ? "選択した会話ログからレポートを作る"
              : view === "generated"
                ? "生成した下書きを確認する"
                : "送付前の最終確認をする"}
          </h3>
          <p className={styles.mutedText}>
            未選択ログは使いません。追加候補は提案だけで、自動追加はしません。
          </p>
        </div>
        <Badge label={`${selectedSessionIds.length} 件選択中`} tone={selectedSessionIds.length > 0 ? "medium" : "neutral"} />
      </div>

      {error ? <div className={styles.inlineError}>{error}</div> : null}

      <div className={styles.metricGrid}>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>対象期間</span>
          <strong>{quality.periodLabel}</strong>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>ドラフト状態</span>
          <strong>{reportStatusLabel(latestReport?.status ?? null)}</strong>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>選択ログ</span>
          <strong>{selectedSessionIds.length} 件</strong>
        </div>
      </div>

      <div className={styles.issueCard}>
        <div className={styles.sectionLabel}>選択中のログ</div>
        {selectedSessions.length === 0 ? (
          <div className={styles.emptyWorkbench}>コミュニケーション履歴タブでログを選ぶと、ここにまとまりが出ます。</div>
        ) : (
          <div className={styles.inlineActions}>
            {selectedSessions.map((session) => (
              <Button key={session.id} size="small" variant="secondary" onClick={() => removeSelectedSession(session.id)}>
                {new Date(session.sessionDate).toLocaleDateString("ja-JP")} / {session.type === "LESSON_REPORT" ? "指導報告" : "面談"} ×
              </Button>
            ))}
          </div>
        )}
      </div>

      {view === "selection" ? (
        <>
          <div className={styles.previewPanel}>
            <pre className={styles.previewText}>{previewText}</pre>
          </div>

          <div className={styles.qualityColumns}>
            <div className={styles.qualityCard}>
              <div className={styles.sectionLabel}>強い要素</div>
              {(quality.strongElements.length > 0 ? quality.strongElements : ["まだ強い要素は十分にそろっていません。"]).map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
            <div className={styles.qualityCard}>
              <div className={styles.sectionLabel}>弱い要素</div>
              {(quality.weakElements.length > 0 ? quality.weakElements : ["この選択でも生成はできますが、もう 1 本足すと厚みが出ます。"]).map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          </div>

          {suggestedSessions.length > 0 ? (
            <div className={styles.issueCard}>
              <div className={styles.sectionLabel}>追加候補</div>
              <div className={styles.inlineActions}>
                {suggestedSessions.map((session) => (
                  <Button
                    key={session.id}
                    size="small"
                    variant="secondary"
                    onClick={() => onSelectedSessionIdsChange([...selectedSessionIds, session.id])}
                  >
                    {new Date(session.sessionDate).toLocaleDateString("ja-JP")} / {session.type === "LESSON_REPORT" ? "指導報告" : "面談"}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          <div className={styles.issueCard}>
            <div className={styles.sectionLabel}>送付前に見ておくこと</div>
            <div className={styles.issueList}>
              {(quality.warnings.length > 0
                ? quality.warnings
                : ["この選択で大きな警告はありません。生成内容を読んで送付可否を判断できます。"]).map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          </div>

          <div className={styles.actionStack}>
            <Button onClick={generateReport} disabled={isGenerating || selectedSessionIds.length === 0}>
              {isGenerating ? "保護者レポートを生成中..." : "保護者レポートを生成"}
            </Button>
          </div>
        </>
      ) : null}

      {view !== "selection" ? (
        <>
          <div className={styles.issueCard}>
            <div className={styles.sectionLabel}>送付前チェック</div>
            <div className={styles.issueList}>
              {(quality.warnings.length > 0 ? quality.warnings : ["本文の流れと表現だけ最後に確認してください。"]).map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          </div>

          <div className={styles.actionStack}>
            {view === "generated" && latestReport && latestReport.status !== "SENT" ? (
              <Button variant="secondary" onClick={() => onViewChange("send")}>
                送付前確認へ進む
              </Button>
            ) : null}
            {view === "send" && latestReport && latestReport.status !== "SENT" ? (
              <Button onClick={markAsSent} disabled={isSending}>
                {isSending ? "送付状態を更新中..." : "送付済みにする"}
              </Button>
            ) : null}
          </div>

          <div className={styles.reportBlocks}>
            <div className={styles.sectionLabel}>生成済みドラフト</div>
            {previewParagraphs.length === 0 ? (
              <div className={styles.emptyWorkbench}>まだドラフトはありません。会話ログを選んで生成してください。</div>
            ) : (
              previewParagraphs.map((paragraph, index) => (
                <article key={`${index}-${paragraph.slice(0, 16)}`} className={styles.reportBlock}>
                  <div className={styles.reportBlockHead}>
                    <strong>{index === 0 ? `${studentName} さんへの報告` : `段落 ${index + 1}`}</strong>
                    <Button
                      size="small"
                      variant="ghost"
                      onClick={() => {
                        const proofId = selectedSessions[index]?.conversation?.id ?? selectedSessions[0]?.conversation?.id;
                        if (proofId) onOpenProof(proofId);
                      }}
                    >
                      根拠を見る
                    </Button>
                  </div>
                  <p className={styles.reportParagraph}>{paragraph.replace(/^#+\s*/gm, "")}</p>
                </article>
              ))
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
