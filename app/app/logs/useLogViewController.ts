"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  hasEditableConversationSummaryChanges,
  normalizeEditableConversationSummary,
  UNSAVED_CONVERSATION_SUMMARY_MESSAGE,
} from "@/lib/conversation-editing";
import {
  normalizeTranscriptReviewMeta,
  transcriptReviewStateLabel,
  transcriptReviewSummary,
  transcriptReviewTone,
} from "@/lib/logs/transcript-review-display";

export type ConversationStatus = "PROCESSING" | "DONE" | "ERROR";
export type TabKey = "summary" | "transcript";

export type ConversationLog = {
  id: string;
  status: ConversationStatus;
  summaryMarkdown?: string | null;
  formattedTranscript?: string | null;
  rawTextOriginal?: string | null;
  rawTextCleaned?: string | null;
  reviewedText?: string | null;
  reviewState?: string;
  qualityMetaJson?: unknown;
  transcriptReview?: unknown;
  student?: { name: string; grade?: string | null } | null;
  session?: { type: string; status: string } | null;
};

type UseLogViewControllerParams = {
  logId: string;
  onSaved?: () => Promise<void> | void;
  onDirtyChange?: (dirty: boolean) => void;
};

export function useLogViewController({ logId, onSaved, onDirtyChange }: UseLogViewControllerParams) {
  const [log, setLog] = useState<ConversationLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("summary");
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [draftSummary, setDraftSummary] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [isSavingSummary, setIsSavingSummary] = useState(false);
  const [pageVisible, setPageVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState === "visible"
  );
  const latestLocationRef = useRef("");
  const lastKickAtRef = useRef(0);

  const fetchLog = useCallback(
    async (opts?: { silent?: boolean; kickProcessing?: boolean }) => {
      const silent = opts?.silent ?? false;
      const kickProcessing = opts?.kickProcessing ?? false;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        if (kickProcessing) {
          const now = Date.now();
          if (now - lastKickAtRef.current >= 3000) {
            lastKickAtRef.current = now;
            void fetch(`/api/conversations/${logId}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
            }).catch(() => {});
          }
        }
        const res = await fetch(`/api/conversations/${logId}`, { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? "ログの取得に失敗しました。");
        setLog(body?.conversation as ConversationLog);
        setError(null);
      } catch (nextError: any) {
        if (!silent) {
          setError(nextError?.message ?? "ログの取得に失敗しました。");
          setLog(null);
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [logId]
  );

  useEffect(() => {
    void fetchLog();
  }, [fetchLog]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const updateVisibility = () => setPageVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => {
    if (!log || log.status !== "PROCESSING" || !pageVisible) return;
    const timer = window.setTimeout(() => {
      void fetchLog({ silent: true, kickProcessing: true });
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [fetchLog, log, pageVisible]);

  useEffect(() => {
    if (!pageVisible || log?.status !== "PROCESSING") return;
    void fetchLog({ silent: true, kickProcessing: true });
  }, [fetchLog, log?.status, pageVisible]);

  const summaryMarkdown = useMemo(
    () => normalizeEditableConversationSummary(log?.summaryMarkdown),
    [log?.summaryMarkdown]
  );
  const transcriptReview = useMemo(
    () => normalizeTranscriptReviewMeta(log?.transcriptReview ?? log?.qualityMetaJson),
    [log?.qualityMetaJson, log?.transcriptReview]
  );
  const transcriptText = log?.formattedTranscript || log?.reviewedText || log?.rawTextCleaned || log?.rawTextOriginal || "";
  const normalizedDraftSummary = useMemo(
    () => normalizeEditableConversationSummary(draftSummary),
    [draftSummary]
  );
  const isDirty = isEditingSummary && hasEditableConversationSummaryChanges(summaryMarkdown, draftSummary);
  const canEditSummary = log?.status === "DONE";

  useEffect(() => {
    latestLocationRef.current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  }, []);

  useEffect(() => {
    if (isEditingSummary) return;
    setDraftSummary(summaryMarkdown);
    setSaveError(null);
  }, [isEditingSummary, summaryMarkdown]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
    return () => onDirtyChange?.(false);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (!isDirty) return undefined;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const link = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!link) return;
      if (link.target === "_blank" || link.hasAttribute("download")) return;
      const href = link.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
      if (window.confirm(UNSAVED_CONVERSATION_SUMMARY_MESSAGE)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const handlePopState = () => {
      if (window.confirm(UNSAVED_CONVERSATION_SUMMARY_MESSAGE)) return;
      window.history.pushState(null, "", latestLocationRef.current || window.location.href);
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleDocumentClick, true);
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleDocumentClick, true);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [isDirty]);

  const startEditingSummary = useCallback(() => {
    setDraftSummary(summaryMarkdown);
    setIsEditingSummary(true);
    setSaveError(null);
    setSaveNotice(null);
  }, [summaryMarkdown]);

  const onDraftSummaryChange = useCallback((nextDraft: string) => {
    setDraftSummary(nextDraft);
    setSaveError(null);
    setSaveNotice(null);
  }, []);

  const stopEditingSummary = useCallback(() => {
    if (isDirty && !window.confirm(UNSAVED_CONVERSATION_SUMMARY_MESSAGE)) return;
    setDraftSummary(summaryMarkdown);
    setIsEditingSummary(false);
    setSaveError(null);
    setSaveNotice(null);
  }, [isDirty, summaryMarkdown]);

  const saveSummary = useCallback(async () => {
    if (!log) return;
    if (!normalizedDraftSummary) {
      setSaveError("本文が空のままでは保存できません。");
      return;
    }

    setIsSavingSummary(true);
    setSaveError(null);
    setSaveNotice(null);
    try {
      const res = await fetch(`/api/conversations/${logId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ summaryMarkdown: draftSummary }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error ?? "本文の保存に失敗しました。");
      }
      const nextConversation = body?.conversation as ConversationLog;
      setLog(nextConversation);
      const nextSummary = normalizeEditableConversationSummary(nextConversation?.summaryMarkdown);
      setDraftSummary(nextSummary);
      setIsEditingSummary(false);
      setSaveNotice("本文を保存しました。");
      await onSaved?.();
    } catch (nextError: any) {
      setSaveError(nextError?.message ?? "本文の保存に失敗しました。");
    } finally {
      setIsSavingSummary(false);
    }
  }, [draftSummary, log, logId, normalizedDraftSummary, onSaved]);

  return {
    log,
    loading,
    error,
    tab,
    setTab,
    isEditingSummary,
    draftSummary,
    setDraftSummary,
    saveError,
    saveNotice,
    isSavingSummary,
    summaryMarkdown,
    transcriptReview,
    transcriptText,
    isDirty,
    canEditSummary,
    normalizedDraftSummary,
    fetchLog,
    onDraftSummaryChange,
    startEditingSummary,
    stopEditingSummary,
    saveSummary,
    transcriptReviewStateLabel,
    transcriptReviewSummary,
    transcriptReviewTone,
  };
}
