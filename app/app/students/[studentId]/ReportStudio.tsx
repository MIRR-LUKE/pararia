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
  const bundleQuality = useMemo(() => buildBundleQualityEval(bundleLogs, allBundleLogs), [bundleLogs, allBundleLogs]);
  const pendingEntityCount = useMemo(
    () => selectedSessions.reduce((acc, session) => acc + (session.pendingEntityCount ?? 0), 0),
    [selectedSessions]
  );
  const suggestedSessions = useMemo(
    () => candidateSessions.filter((session) => bundleQuality.suggestedLogIds.includes(session.id)),
    [bundleQuality.suggestedLogIds, candidateSessions]
  );

  const previewParagraphs = splitParagraphs(content || latestReport?.reportMarkdown);

  const structurePreview = [
    { label: "今回の様子", ready: bundleLogs.length > 0 },
    { label: "学習状況の変化", ready: bundleQuality.mainThemes.length > 0 },
    { label: "講師としての見立て", ready: bundleQuality.strongElements.length > 0 },
    { label: "科目別またはテーマ別の具体策", ready: bundleQuality.mainThemes.length > 1 },
    { label: "リスクとその意味", ready: bundleQuality.weakElements.length > 0 },
    { label: "ご家庭で見てほしいこと", ready: bundleQuality.parentPoints.length > 0 },
  ];

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

  return (
    <section className={styles.workbenchSection} aria-label="保護者レポート生成">
      <div className={styles.workbenchHeader}>
        <div>
          <div className={styles.eyebrow}>保護者レポート</div>
          <h3 className={styles.workbenchTitle}>
            {panel === "report_selection"
              ? "選択した会話ログを束ねてレポートを作る"
              : panel === "report_generated"
                ? "生成した下書きを確認する"
                : "送付前の最終確認をする"}
          </h3>
          <p className={styles.mutedText}>
            未選択ログは使いません。会話ログのまとまりを見ながら、必要な分だけで保護者レポートを作ります。
          </p>
        </div>
        <Badge label={`選択中 ${selectedSessionIds.length} 件`} tone={selectedSessionIds.length > 0 ? "neutral" : "medium"} />
      </div>

      {error ? <div className={styles.inlineError}>{error}</div> : null}

      <div className={styles.metricGrid}>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>対象期間</span>
          <strong>{bundleQuality.periodLabel}</strong>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>未確認 entity</span>
          <strong>{pendingEntityCount} 件</strong>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>ドラフト状態</span>
          <strong>{reportStatusLabel(latestReport?.status ?? null)}</strong>
        </div>
      </div>

      {panel === "report_selection" ? (
        <>
          <div className={styles.structureList}>
            {structurePreview.map((item) => (
              <div key={item.label} className={styles.structureItem}>
                <span>{item.label}</span>
                <Badge label={item.ready ? "出せる" : "弱い"} tone={item.ready ? "low" : "medium"} />
              </div>
            ))}
          </div>

          <div className={styles.previewPanel}>
            <pre className={styles.previewText}>{buildBundlePreview(bundleQuality)}</pre>
          </div>

          <div className={styles.qualityColumns}>
            <div className={styles.qualityCard}>
              <div className={styles.sectionLabel}>強い要素</div>
              {(bundleQuality.strongElements.length > 0 ? bundleQuality.strongElements : ["まだ強い要素は十分に揃っていません。"]).map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
            <div className={styles.qualityCard}>
              <div className={styles.sectionLabel}>弱い要素</div>
              {(bundleQuality.weakElements.length > 0 ? bundleQuality.weakElements : ["いまの選択でも生成はできますが、もう 1 本足すと厚みが出ます。"]).map((item) => (
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

          <div className={styles.issueCard}>
            <div className={styles.sectionLabel}>送付前に見ておくこと</div>
            <div className={styles.issueList}>
              {(bundleQuality.warnings.length > 0 ? bundleQuality.warnings : ["この選択で大きな警告はありません。固有名詞だけは最後に確認してください。"]).map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          </div>

          <div className={styles.actionStack}>
            <Button onClick={generate} disabled={generating || selectedSessionIds.length === 0}>
              {generating ? "保護者レポートを生成中..." : "この選択で保護者レポートを生成"}
            </Button>
          </div>
        </>
      ) : null}

      {panel !== "report_selection" ? (
        <>
          <div className={styles.issueCard}>
            <div className={styles.sectionLabel}>送付前チェック</div>
            <div className={styles.issueList}>
              <p>未確認 entity: {pendingEntityCount} 件</p>
              {(bundleQuality.warnings.length > 0 ? bundleQuality.warnings : ["本文の根拠と固有名詞を最後に確認してください。"]).map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          </div>

          <div className={styles.actionStack}>
            {panel === "report_generated" && latestReport && latestReport.status !== "SENT" ? (
              <Button variant="secondary" onClick={onSendReady}>
                送付前確認へ進む
              </Button>
            ) : null}
            {panel === "send_ready" && latestReport && latestReport.status !== "SENT" ? (
              <Button disabled={pendingEntityCount > 0 || sending} onClick={markAsSent}>
                {pendingEntityCount > 0 ? "未確認 entity の解消後に送付できます" : sending ? "送付状態を更新中..." : "送付済みにする"}
              </Button>
            ) : null}
          </div>

          <div className={styles.reportBlocks}>
            <div className={styles.sectionLabel}>生成済みドラフト</div>
            {previewParagraphs.length === 0 ? (
              <div className={styles.emptyWorkbench}>まだドラフトはありません。選択した会話ログから生成してください。</div>
            ) : (
              previewParagraphs.map((block, index) => (
                <article key={`${index}-${block.slice(0, 20)}`} className={styles.reportBlock}>
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
                  <p className={styles.reportParagraph}>{block.replace(/^#+\s*/gm, "")}</p>
                </article>
              ))
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
