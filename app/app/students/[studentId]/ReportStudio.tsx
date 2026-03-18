"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { buildBundlePreview, buildBundleQualityEval, type ReportBundleLog } from "@/lib/operational-log";
import type { ReportItem, SessionItem, WorkbenchPanel } from "./roomTypes";
import styles from "./studentWorkbench.module.css";

type Props = {
  panel: Extract<WorkbenchPanel, "report_selection" | "report_generated" | "send_ready">;
  studentId: string;
  studentName: string;
  sessions: SessionItem[];
  reports: ReportItem[];
  selectedSessionIds: string[];
  onSelectedSessionIdsChange: (ids: string[]) => void;
  onRefresh: () => void;
  onOpenProof: (logId: string) => void;
  onOpenGenerated: () => void;
  onSendReady: () => void;
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
  if (status === "DRAFT") return "下書きあり";
  if (status === "REVIEWED") return "確認済み";
  if (status === "SENT") return "送付済み";
  return status;
}

function reportTone(status?: string | null): "neutral" | "low" | "medium" | "high" {
  if (!status) return "medium";
  if (status === "SENT") return "low";
  if (status === "REVIEWED") return "low";
  if (status === "DRAFT") return "medium";
  return "neutral";
}

function splitParagraphs(markdown?: string | null) {
  if (!markdown) return [];
  return markdown
    .split(/\n\s*\n/g)
    .map((block) => block.replace(/\r/g, "").trim())
    .filter(Boolean);
}

export function ReportStudio({
  panel,
  studentId,
  studentName,
  sessions,
  reports,
  selectedSessionIds,
  onSelectedSessionIdsChange,
  onRefresh,
  onOpenProof,
  onOpenGenerated,
  onSendReady,
}: Props) {
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);

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
    if (latestReport?.reportMarkdown && !content) {
      setContent(latestReport.reportMarkdown);
    }
  }, [content, latestReport?.reportMarkdown]);

  const bundleLogs = useMemo(() => toBundleLogs(selectedSessions), [selectedSessions]);
  const allBundleLogs = useMemo(() => toBundleLogs(candidateSessions), [candidateSessions]);
  const bundleQuality = useMemo(() => buildBundleQualityEval(bundleLogs, allBundleLogs), [allBundleLogs, bundleLogs]);
  const pendingEntityCount = useMemo(
    () => selectedSessions.reduce((acc, session) => acc + (session.pendingEntityCount ?? 0), 0),
    [selectedSessions]
  );
  const suggestedSessions = useMemo(
    () => candidateSessions.filter((session) => bundleQuality.suggestedLogIds.includes(session.id)),
    [bundleQuality.suggestedLogIds, candidateSessions]
  );
  const showGenerated = panel === "report_generated" || panel === "send_ready";
  const showSendChecklist = panel === "send_ready";
  const structurePreview = useMemo(() => {
    return [
      { label: "今回の様子", state: bundleLogs.length > 0 ? "出せる" : "不足" },
      { label: "学習状況の変化", state: bundleQuality.mainThemes.length > 0 ? "出せる" : "不足" },
      { label: "講師としての見立て", state: bundleQuality.strongElements.length > 0 ? "強い" : "弱い" },
      { label: "科目別具体策", state: bundleQuality.mainThemes.length > 1 ? "出せる" : "薄い" },
      { label: "リスクとその意味", state: bundleQuality.weakElements.length > 0 ? "出せる" : "薄い" },
      { label: "家庭で見てほしいこと", state: bundleQuality.parentPoints.length > 0 ? "出せる" : "弱い" },
    ];
  }, [bundleLogs.length, bundleQuality.mainThemes.length, bundleQuality.parentPoints.length, bundleQuality.strongElements.length, bundleQuality.weakElements.length]);

  const toggleSession = (sessionId: string) => {
    onSelectedSessionIdsChange(
      selectedSessionIds.includes(sessionId)
        ? selectedSessionIds.filter((id) => id !== sessionId)
        : [...selectedSessionIds, sessionId]
    );
  };

  const generate = async () => {
    if (selectedSessionIds.length === 0) return;
    setGenerating(true);
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
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "保護者レポートの生成に失敗しました。");
      setContent(body.report?.reportMarkdown ?? "");
      await onRefresh();
      onOpenGenerated();
    } catch (nextError: any) {
      setError(nextError?.message ?? "保護者レポートの生成に失敗しました。");
    } finally {
      setGenerating(false);
    }
  };

  const markAsSent = async () => {
    if (!latestReport) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${latestReport.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliveryChannel: "manual" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "送付状態の更新に失敗しました。");
      await onRefresh();
    } catch (nextError: any) {
      setError(nextError?.message ?? "送付状態の更新に失敗しました。");
    } finally {
      setSending(false);
    }
  };

  const previewParagraphs = splitParagraphs(content || latestReport?.reportMarkdown);

  return (
    <section className={styles.workbenchSection} aria-label="保護者レポートのワークベンチ">
      <div className={styles.workbenchHeader}>
        <div>
          <div className={styles.eyebrow}>保護者レポート</div>
          <h3 className={styles.workbenchTitle}>
            {panel === "report_selection"
              ? "ログを見ながら右でレポを組む"
              : panel === "report_generated"
                ? "生成済みドラフトを確認する"
                : "送付前の確認だけを終える"}
          </h3>
          <p className={styles.mutedText}>
            {panel === "report_selection"
              ? "選択ログのまとまりを先に確認してから生成します。作文画面ではなく、講師判断を整える面です。"
              : panel === "report_generated"
                ? "段落ごとの根拠を見ながら、講師判断が通っているかを確認します。"
                : "未確認の固有名詞と警告だけを止めて、送付の事故を防ぎます。"}
          </p>
        </div>
        <Badge label={`${selectedSessionIds.length} 件選択`} tone={selectedSessionIds.length > 0 ? "neutral" : "medium"} />
      </div>

      <div className={styles.metricGrid}>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>対象期間</span>
          <strong>{bundleQuality.periodLabel}</strong>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>未確認の固有名詞</span>
          <strong>{pendingEntityCount} 件</strong>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>ドラフト状態</span>
          <strong>{reportStatusLabel(latestReport?.status ?? null)}</strong>
        </div>
      </div>

      {error ? <div className={styles.inlineError}>{error}</div> : null}

      {panel === "report_selection" ? (
        <>
          <div className={styles.structureList}>
            {structurePreview.map((item) => (
              <div key={item.label} className={styles.structureItem}>
                <span>{item.label}</span>
                <Badge label={item.state} tone={item.state === "弱い" || item.state === "不足" || item.state === "薄い" ? "medium" : "low"} />
              </div>
            ))}
          </div>

          <div className={styles.previewPanel}>
            <pre className={styles.previewText}>{buildBundlePreview(bundleQuality)}</pre>
          </div>

          <div className={styles.qualityColumns}>
            <div className={styles.qualityCard}>
              <div className={styles.sectionLabel}>強い要素</div>
              {(bundleQuality.strongElements.length > 0 ? bundleQuality.strongElements : ["まだ強い軸が足りません。"]).map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
            <div className={styles.qualityCard}>
              <div className={styles.sectionLabel}>弱い要素</div>
              {(bundleQuality.weakElements.length > 0 ? bundleQuality.weakElements : ["この選び方なら大きな欠落はありません。"]).map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          </div>

          {suggestedSessions.length > 0 ? (
            <div className={styles.issueCard}>
              <div className={styles.sectionLabel}>追加候補</div>
              <div className={styles.inlineActions}>
                {suggestedSessions.map((session) => (
                  <Button key={session.id} size="small" variant="secondary" onClick={() => toggleSession(session.id)}>
                    {new Date(session.sessionDate).toLocaleDateString("ja-JP")} / {session.type === "LESSON_REPORT" ? "指導報告" : "面談"}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      <div className={styles.issueCard}>
        <div className={styles.sectionLabel}>{showSendChecklist ? "送付前チェック" : "品質警告"}</div>
        <div className={styles.issueList}>
          <p>未確認の固有名詞: {pendingEntityCount} 件</p>
          {(bundleQuality.warnings.length > 0 ? bundleQuality.warnings : ["この選択なら送付前の大きな警告はありません。"]).map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
      </div>

      <div className={styles.actionStack}>
        {panel === "report_selection" ? (
          <Button onClick={generate} disabled={generating || selectedSessionIds.length === 0}>
            {generating ? "保護者レポートを生成中..." : "この選択で保護者レポートを生成"}
          </Button>
        ) : null}
        {showGenerated && latestReport && latestReport.status !== "SENT" ? (
          <Button variant="secondary" onClick={onSendReady}>
            送付前確認へ進む
          </Button>
        ) : null}
        {showSendChecklist && latestReport && latestReport.status !== "SENT" ? (
          <Button disabled={pendingEntityCount > 0 || sending} onClick={markAsSent}>
            {pendingEntityCount > 0 ? "固有名詞の確認後に送付" : sending ? "送付状態を更新中..." : "送付準備完了にする"}
          </Button>
        ) : null}
      </div>

      {showGenerated ? (
        <div className={styles.reportBlocks}>
          <div className={styles.sectionLabel}>生成後ドラフト</div>
          {previewParagraphs.length === 0 ? (
            <div className={styles.emptyWorkbench}>まだドラフトはありません。左の会話ログを選んで生成します。</div>
          ) : (
            previewParagraphs.map((block, index) => (
              <article key={`${index}-${block.slice(0, 20)}`} className={styles.reportBlock}>
                <div className={styles.reportBlockHead}>
                  <strong>{index === 0 ? `${studentName} への報告文` : `段落 ${index + 1}`}</strong>
                  <div className={styles.inlineActions}>
                    <Badge label={`根拠ログ ${selectedSessionIds.length} 件`} tone="neutral" />
                    <Button
                      size="small"
                      variant="ghost"
                      onClick={() => {
                        const firstProof = selectedSessions[index]?.conversation?.id ?? selectedSessions[0]?.conversation?.id;
                        if (firstProof) onOpenProof(firstProof);
                      }}
                    >
                      根拠を見る
                    </Button>
                  </div>
                </div>
                <p className={styles.reportParagraph}>{block.replace(/^#+\s*/gm, "")}</p>
              </article>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}
