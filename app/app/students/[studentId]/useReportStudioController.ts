"use client";

import { useEffect, useMemo, useState } from "react";
import { buildParentReportGenerationProgress } from "@/lib/generation-progress";
import { buildBundlePreview, buildBundleQualityEval, buildReportBundleLog, type ReportBundleLog } from "@/lib/operational-log";
import { reportStatusLabel } from "@/lib/report-delivery";
import type { ReportItem, ReportStudioView, SessionItem } from "./roomTypes";

type UseReportStudioControllerProps = {
  studentId: string;
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

export function useReportStudioController({
  studentId,
  sessions,
  reports,
  selectedSessionIds,
  onSelectedSessionIdsChange,
  onRefresh,
  onOpenLog,
  onViewChange,
}: UseReportStudioControllerProps) {
  const [draftMarkdown, setDraftMarkdown] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [generationStage, setGenerationStage] = useState<"validating" | "gathering" | "drafting" | "saving" | "done" | "error" | null>(
    null
  );

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

  return {
    draftMarkdown,
    setDraftMarkdown,
    error,
    isGenerating,
    isSending,
    generationStage,
    candidateSessions,
    selectedSessions,
    selectedSessionIds,
    onSelectedSessionIdsChange,
    latestReport,
    shareHistory,
    workflowLabel,
    deliveryLabel,
    bundleLogs,
    allBundleLogs,
    quality,
    previewText,
    suggestedSessions,
    previewParagraphs,
    reportGenerationProgress,
    generateReport,
    recordReportAction,
    removeSelectedSession,
    onOpenLog,
  };
}
