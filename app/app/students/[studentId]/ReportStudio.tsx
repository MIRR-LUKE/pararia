"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { GenerationProgress } from "@/components/ui/GenerationProgress";
import { buildParentReportGenerationProgress } from "@/lib/generation-progress";
import { buildBundlePreview, buildBundleQualityEval, buildReportBundleLog, type ReportBundleLog } from "@/lib/operational-log";
import { reportStatusLabel } from "@/lib/report-delivery";
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
  onOpenLog: (logId: string) => void;
  onViewChange: (view: ReportStudioView) => void;
};

function toBundleLogs(sessions: SessionItem[]): ReportBundleLog[] {
  return sessions
    .filter((session) => Boolean(session.conversation?.summaryMarkdown?.trim()))
    .map((session) =>
      buildReportBundleLog({
        id: session.id,
        sessionId: session.id,
        date: session.sessionDate,
        mode: session.type,
        sessionType: session.type,
        artifactJson: session.conversation?.artifactJson,
        summaryMarkdown: session.conversation!.summaryMarkdown!,
      })
    );
}

function splitParagraphs(markdown?: string | null) {
  if (!markdown) return [];
  return markdown
    .split(/\n\s*\n/g)
    .map((block) => block.replace(/\r/g, "").trim())
    .filter(Boolean);
}

function formatHistoryDate(value?: string | null) {
  if (!value) return "時刻未記録";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "時刻未記録";
  return date.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  onOpenLog,
  onViewChange,
}: Props) {
  const [draftMarkdown, setDraftMarkdown] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [generationStage, setGenerationStage] = useState<
    "validating" | "gathering" | "drafting" | "saving" | "done" | "error" | null
  >(null);

  const candidateSessions = useMemo(
    () => sessions.filter((session) => Boolean(session.conversation?.summaryMarkdown?.trim())),
    [sessions]
  );
  const selectedSessions = useMemo(
    () => candidateSessions.filter((session) => selectedSessionIds.includes(session.id)),
    [candidateSessions, selectedSessionIds]
  );
  const latestReport = reports[0] ?? null;
  const shareHistory = latestReport?.history ?? [];
  const workflowLabel = latestReport?.workflowStatusLabel ?? reportStatusLabel(latestReport?.status ?? null);
  const deliveryLabel = latestReport?.deliveryStateLabel ?? workflowLabel;

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
  const reportGenerationProgress =
    generationStage && (isGenerating || generationStage === "error")
      ? buildParentReportGenerationProgress({
          stage: generationStage,
          selectedCount: selectedSessionIds.length,
          lastError: error,
        })
      : null;

  const generateReport = async () => {
    if (selectedSessionIds.length === 0) return;
    setIsGenerating(true);
    setError(null);
    setGenerationStage("validating");
    try {
      const payload = {
        studentId,
        sessionIds: selectedSessionIds,
      };
      setGenerationStage("gathering");
      await Promise.resolve();
      setGenerationStage("drafting");
      const res = await fetch("/api/ai/generate-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error ?? "保護者レポートの生成に失敗しました。");
      }
      setGenerationStage("saving");
      setDraftMarkdown(body?.report?.reportMarkdown ?? "");
      await onRefresh();
      setGenerationStage("done");
      onViewChange("generated");
    } catch (nextError: any) {
      setGenerationStage("error");
      setError(nextError?.message ?? "保護者レポートの生成に失敗しました。");
    } finally {
      setIsGenerating(false);
    }
  };

  const recordReportAction = async (
    action: "review" | "sent" | "failed" | "bounced" | "manual_share" | "resent",
    deliveryChannel?: string
  ) => {
    if (!latestReport) return;
    setIsSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${latestReport.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          deliveryChannel,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error ?? "共有状態の更新に失敗しました。");
      }
      await onRefresh();
      if (action === "review") {
        onViewChange("send");
      }
    } catch (nextError: any) {
      setError(nextError?.message ?? "共有状態の更新に失敗しました。");
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
                : "共有前後の状態を記録する"}
          </h3>
          <p className={styles.mutedText}>
            未選択ログは使いません。追加候補は提案だけで、自動追加はしません。
          </p>
        </div>
        <Badge
          label={`${selectedSessionIds.length} 件選択中`}
          tone={selectedSessionIds.length > 0 ? "medium" : "neutral"}
        />
      </div>

      {error ? <div className={styles.inlineError}>{error}</div> : null}

      <div className={styles.metricGrid}>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>対象期間</span>
          <strong>{quality.periodLabel}</strong>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>ワークフロー</span>
          <strong>{workflowLabel}</strong>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>共有状態</span>
          <strong>{deliveryLabel}</strong>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>選択ログ</span>
          <strong>{selectedSessionIds.length} 件</strong>
        </div>
      </div>

      <div className={styles.issueCard}>
        <div className={styles.sectionLabel}>選択中のログ</div>
        {selectedSessions.length === 0 ? (
          <div className={styles.emptyWorkbench}>
            コミュニケーション履歴タブでログを選ぶと、ここにまとまりが出ます。
          </div>
        ) : (
          <div className={styles.inlineActions}>
            {selectedSessions.map((session) => (
              <Button
                key={session.id}
                size="small"
                variant="secondary"
                onClick={() => removeSelectedSession(session.id)}
              >
                {new Date(session.sessionDate).toLocaleDateString("ja-JP")} /{" "}
                {session.type === "LESSON_REPORT" ? "指導報告" : "面談"} ×
              </Button>
            ))}
          </div>
        )}
      </div>

      {view === "selection" ? (
        <>
          {reportGenerationProgress ? <GenerationProgress progress={reportGenerationProgress} /> : null}

          <div className={styles.previewPanel}>
            <pre className={styles.previewText}>{previewText}</pre>
          </div>

          <div className={styles.qualityColumns}>
            <div className={styles.qualityCard}>
              <div className={styles.sectionLabel}>強い要素</div>
              {(quality.strongElements.length > 0
                ? quality.strongElements
                : ["まだ強い要素は十分にそろっていません。"]
              ).map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
            <div className={styles.qualityCard}>
              <div className={styles.sectionLabel}>弱い要素</div>
              {(quality.weakElements.length > 0
                ? quality.weakElements
                : ["この選択でも生成はできますが、もう 1 本足すと厚みが出ます。"]
              ).map((item) => (
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
                    {new Date(session.sessionDate).toLocaleDateString("ja-JP")} /{" "}
                    {session.type === "LESSON_REPORT" ? "指導報告" : "面談"}
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
                : ["この選択で大きな警告はありません。生成内容を読んで共有可否を判断できます。"]
              ).map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          </div>

          <div className={styles.actionStack}>
            <Button onClick={generateReport} disabled={isGenerating || selectedSessionIds.length === 0}>
              {isGenerating ? "保護者レポートを生成中..." : "保護者レポートを生成"}
            </Button>
            <div className={styles.progressNote}>
              選択確認 → ログ整理 → 本文生成 → 保存反映 の順で進みます。進捗は実際の処理段階に合わせて更新します。
            </div>
          </div>
        </>
      ) : null}

      {view !== "selection" ? (
        <>
          <div className={styles.issueCard}>
            <div className={styles.sectionLabel}>送付前チェック</div>
            <div className={styles.issueList}>
              {(quality.warnings.length > 0
                ? quality.warnings
                : ["本文の流れと表現だけ最後に確認してください。"]
              ).map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          </div>

          <div className={styles.issueCard}>
            <div className={styles.sectionLabel}>共有履歴</div>
            {shareHistory.length === 0 ? (
              <div className={styles.emptyWorkbench}>まだ共有履歴はありません。レビューや共有の操作を行うとここに残ります。</div>
            ) : (
              <div className={styles.issueList}>
                {shareHistory
                  .slice()
                  .reverse()
                  .map((item) => (
                    <p key={`${item.eventType}-${item.createdAt}-${item.id ?? "history"}`}>
                      <strong>{item.label}</strong>
                      {" / "}
                      {formatHistoryDate(item.createdAt)}
                      {item.actor?.name ? ` / ${item.actor.name}` : ""}
                      {item.deliveryChannel ? ` / ${item.deliveryChannel}` : ""}
                      {item.note ? ` / ${item.note}` : ""}
                    </p>
                  ))}
              </div>
            )}
          </div>

          <div className={styles.actionStack}>
            {view === "generated" && latestReport?.needsReview ? (
              <Button onClick={() => void recordReportAction("review")} disabled={isSending}>
                {isSending ? "レビュー状態を更新中..." : "確認済みにする"}
              </Button>
            ) : null}

            {view === "generated" && latestReport ? (
              <Button variant="secondary" onClick={() => onViewChange("send")}>
                共有ステータスを記録する
              </Button>
            ) : null}

            {view === "send" && latestReport ? (
              <>
                <Button onClick={() => void recordReportAction("manual_share", "manual")} disabled={isSending}>
                  {isSending ? "共有状態を更新中..." : "手動共有として記録"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void recordReportAction(
                      latestReport.deliveryState === "failed" || latestReport.deliveryState === "bounced"
                        ? "resent"
                        : "sent",
                      "email"
                    )
                  }
                  disabled={isSending}
                >
                  {latestReport.deliveryState === "failed" || latestReport.deliveryState === "bounced"
                    ? "再送済みとして記録"
                    : "送信済みとして記録"}
                </Button>
                <Button variant="ghost" onClick={() => void recordReportAction("failed", "email")} disabled={isSending}>
                  送信失敗を記録
                </Button>
                <Button variant="ghost" onClick={() => void recordReportAction("bounced", "email")} disabled={isSending}>
                  宛先エラーを記録
                </Button>
              </>
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
                        const logId =
                          selectedSessions[index]?.conversation?.id ?? selectedSessions[0]?.conversation?.id;
                        if (logId) onOpenLog(logId);
                      }}
                    >
                      ログを見る
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
