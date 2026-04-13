"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StructuredMarkdown } from "@/components/ui/StructuredMarkdown";
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
import styles from "./[logId]/logView.module.css";

type ConversationStatus = "PROCESSING" | "DONE" | "ERROR";
type TabKey = "summary" | "transcript";

type ConversationLog = {
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

type Props = {
  logId: string;
  showHeader?: boolean;
  onBack?: () => void;
  onSaved?: () => Promise<void> | void;
  onDirtyChange?: (dirty: boolean) => void;
};

const TAB_LABELS: Array<{ key: TabKey; label: string }> = [
  { key: "summary", label: "ログ" },
  { key: "transcript", label: "文字起こし" },
];

const STATUS_LABEL: Record<ConversationStatus, string> = {
  PROCESSING: "生成中",
  DONE: "確認可能",
  ERROR: "エラー",
};

function toneFromStatus(status: ConversationStatus): "neutral" | "low" | "medium" | "high" {
  if (status === "DONE") return "low";
  if (status === "ERROR") return "high";
  return "medium";
}

function logTitle(type?: string | null) {
  return type === "LESSON_REPORT" ? "指導報告ログ" : "面談ログ";
}

export function LogView({ logId, showHeader = true, onBack, onSaved, onDirtyChange }: Props) {
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

  const fetchLog = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const res = await fetch(`/api/conversations/${logId}?process=1`, { cache: "no-store" });
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
  }, [logId]);

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
      void fetchLog({ silent: true });
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [fetchLog, log, pageVisible]);

  useEffect(() => {
    if (!pageVisible || log?.status !== "PROCESSING") return;
    void fetchLog({ silent: true });
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
  const isDirty = isEditingSummary && hasEditableConversationSummaryChanges(summaryMarkdown, draftSummary);
  const canEditSummary = log?.status === "DONE";
  const normalizedDraftSummary = useMemo(
    () => normalizeEditableConversationSummary(draftSummary),
    [draftSummary]
  );

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

      <div className={styles.trustPanel}>
        <div className={styles.trustTop}>
          <div className={styles.trustCopy}>
            <div className={styles.sectionLabel}>信頼判断</div>
            <p className={styles.trustSummary}>{transcriptReviewSummary(transcriptReview)}</p>
            <p className={styles.subtext}>
              {transcriptReview?.updatedAt
                ? `最終更新 ${new Date(transcriptReview.updatedAt).toLocaleString("ja-JP")}`
                : "レビュー理由はログ本文と同じく、ここで確認できます。"}
            </p>
          </div>
          <Badge
            label={transcriptReviewStateLabel(log.reviewState)}
            tone={transcriptReviewTone(log.reviewState, transcriptReview)}
          />
        </div>
        {transcriptReview?.reasons?.length ? (
          <div className={styles.trustReasons}>
            {transcriptReview.reasons.map((reason) => (
              <div key={reason.code} className={styles.trustReason}>
                <div className={styles.reasonCode}>{reason.code}</div>
                <p className={styles.reasonMessage}>{reason.message}</p>
                {typeof reason.count === "number" ? <span className={styles.reasonCount}>{reason.count}件</span> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>

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

      {log.status === "PROCESSING" ? (
        <div className={styles.progressBanner}>生成途中のため自動で更新しています。ログ本文ができしだい表示されます。</div>
      ) : null}

      {tab === "summary" ? (
        <div className={styles.stack}>
          {canEditSummary ? (
            <div className={styles.editorToolbar}>
              <div className={styles.editorMetaBlock}>
                <div className={styles.sectionLabel}>本文編集</div>
                <p className={styles.subtext}>
                  自動保存はしません。見出し構成を残したまま直すと、保護者レポート側にも反映しやすくなります。
                </p>
              </div>
              <div className={styles.inlineActions}>
                {isDirty ? <span className={styles.editStatePill}>未保存</span> : null}
                {!isEditingSummary ? (
                  <Button variant="secondary" onClick={startEditingSummary}>
                    本文を編集
                  </Button>
                ) : (
                  <>
                    <Button variant="secondary" onClick={stopEditingSummary} disabled={isSavingSummary}>
                      編集をやめる
                    </Button>
                    <Button onClick={() => void saveSummary()} disabled={isSavingSummary || !isDirty || !normalizedDraftSummary}>
                      {isSavingSummary ? "保存中..." : "保存する"}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ) : null}

          {saveError ? <div className={styles.inlineError}><p>{saveError}</p></div> : null}
          {saveNotice ? <div className={styles.progressBanner}>{saveNotice}</div> : null}

          {isEditingSummary ? (
            <div className={styles.editorGrid}>
              <div className={styles.stack}>
                <div className={styles.sectionLabel}>編集内容</div>
                <textarea
                  className={styles.summaryEditor}
                  value={draftSummary}
                  onChange={(event) => {
                    setDraftSummary(event.target.value);
                    setSaveError(null);
                    setSaveNotice(null);
                  }}
                  spellCheck={false}
                  aria-label="ログ本文の編集"
                />
              </div>
              <div className={styles.stack}>
                <div className={styles.sectionLabel}>プレビュー</div>
                <div className={styles.contentPanel}>
                  <StructuredMarkdown
                    markdown={normalizedDraftSummary}
                    emptyMessage="本文を入力するとここにプレビューが出ます。"
                    className={styles.structuredContent}
                  />
                </div>
              </div>
            </div>
          ) : (
          <div className={styles.contentPanel}>
            <StructuredMarkdown
              markdown={summaryMarkdown}
              emptyMessage="まだログ本文は生成されていません。生成中の場合はこのまま自動更新されます。"
              className={styles.structuredContent}
            />
          </div>
          )}
        </div>
      ) : null}

      {tab === "transcript" ? (
        <div className={styles.stack}>
          <div className={styles.contentPanel}>
            <StructuredMarkdown
              markdown={transcriptText}
              emptyMessage="まだ文字起こしはありません。"
              className={styles.structuredContent}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
