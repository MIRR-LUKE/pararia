"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StructuredMarkdown } from "@/components/ui/StructuredMarkdown";
import {
  normalizeTranscriptReviewMeta,
  transcriptReviewStateLabel,
  transcriptReviewSummary,
  transcriptReviewTone,
} from "@/lib/logs/transcript-review-display";
import type { ConversationSuggestionList } from "@/lib/transcript/review-types";
import styles from "./TranscriptReviewPage.module.css";

type ConversationSnapshot = {
  id: string;
  status: string;
  reviewState: string;
  summaryMarkdown?: string | null;
  formattedTranscript?: string | null;
  rawTextOriginal?: string | null;
  rawTextCleaned?: string | null;
  reviewedText?: string | null;
  qualityMetaJson?: unknown;
  transcriptReview?: unknown;
  student: { id: string; name: string; grade?: string | null } | null;
  session: { type: string; status: string; sessionDate?: string | Date | null } | null;
};

type Props = {
  logId: string;
  initialConversation: ConversationSnapshot;
  initialReview: ConversationSuggestionList;
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: "確認待ち",
  CONFIRMED: "採用",
  REJECTED: "却下",
  MANUALLY_EDITED: "手修正",
};

const STATUS_TONE: Record<string, "neutral" | "low" | "medium" | "high"> = {
  PENDING: "medium",
  CONFIRMED: "low",
  REJECTED: "neutral",
  MANUALLY_EDITED: "low",
};

const SOURCE_LABEL: Record<string, string> = {
  GLOSSARY: "辞書",
  CONTEXT: "文脈",
  ALIAS: "別名",
  HEURISTIC: "推定",
};

const PART_TYPE_LABEL: Record<string, string> = {
  FULL: "全体",
  TEXT_NOTE: "メモ",
};

function sessionTypeLabel(type?: string | null) {
  return "面談";
}

function transcriptLabel(conversation: ConversationSnapshot) {
  if (conversation.reviewedText?.trim()) return "reviewedText";
  if (conversation.rawTextCleaned?.trim()) return "rawTextCleaned";
  if (conversation.rawTextOriginal?.trim()) return "rawTextOriginal";
  return "未生成";
}

function formatUpdatedAt(value?: string | null) {
  if (!value) return "未更新";
  return new Date(value).toLocaleString("ja-JP");
}

export default function TranscriptReviewPage({ logId, initialConversation, initialReview }: Props) {
  const [conversation, setConversation] = useState(initialConversation);
  const [review, setReview] = useState(initialReview);
  const [refreshing, setRefreshing] = useState(false);
  const [savingSuggestionId, setSavingSuggestionId] = useState<string | null>(null);
  const [editingSuggestionId, setEditingSuggestionId] = useState<string | null>(null);
  const [manualValues, setManualValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const transcriptReview = useMemo(
    () => normalizeTranscriptReviewMeta(conversation.transcriptReview ?? conversation.qualityMetaJson),
    [conversation.qualityMetaJson, conversation.transcriptReview]
  );

  const pendingSuggestionCount = review.suggestions.filter((item) => item.status === "PENDING").length;
  const confirmedSuggestionCount = review.suggestions.filter((item) => item.status === "CONFIRMED").length;
  const manualSuggestionCount = review.suggestions.filter((item) => item.status === "MANUALLY_EDITED").length;
  const reviewSummary = transcriptReviewSummary(transcriptReview);
  const reviewText = review.displayText || review.reviewedText || review.rawTextOriginal || "";

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const [conversationRes, reviewRes] = await Promise.all([
        fetch(`/api/conversations/${logId}`, { cache: "no-store" }),
        fetch(`/api/conversations/${logId}/review`, { cache: "no-store" }),
      ]);
      const conversationBody = await conversationRes.json().catch(() => ({}));
      const reviewBody = await reviewRes.json().catch(() => ({}));
      if (!conversationRes.ok) {
        throw new Error(conversationBody?.error ?? "ログの更新に失敗しました。");
      }
      if (!reviewRes.ok) {
        throw new Error(reviewBody?.error ?? "レビューの更新に失敗しました。");
      }
      setConversation(conversationBody?.conversation as ConversationSnapshot);
      setReview(reviewBody?.review as ConversationSuggestionList);
    } catch (nextError: any) {
      setError(nextError?.message ?? "更新に失敗しました。");
    } finally {
      setRefreshing(false);
    }
  }, [logId]);

  const runReview = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${logId}/review`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error ?? "レビューを生成できませんでした。");
      }
      await refreshAll();
    } catch (nextError: any) {
      setError(nextError?.message ?? "レビューを生成できませんでした。");
    } finally {
      setRefreshing(false);
    }
  }, [logId, refreshAll]);

  const updateSuggestion = useCallback(
    async (suggestionId: string, payload: { status: "CONFIRMED" | "REJECTED" | "MANUALLY_EDITED"; finalValue?: string | null }) => {
      setSavingSuggestionId(suggestionId);
      setError(null);
      try {
        const res = await fetch(`/api/conversations/${logId}/review/suggestions/${suggestionId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body?.error ?? "候補の更新に失敗しました。");
        }
        await refreshAll();
        setEditingSuggestionId((current) => (current === suggestionId ? null : current));
        setManualValues((current) => {
          const next = { ...current };
          delete next[suggestionId];
          return next;
        });
      } catch (nextError: any) {
        setError(nextError?.message ?? "候補の更新に失敗しました。");
      } finally {
        setSavingSuggestionId(null);
      }
    },
    [logId, refreshAll]
  );

  const startManualEdit = useCallback(
    (suggestionId: string, suggestedValue: string, finalValue?: string | null) => {
      setEditingSuggestionId(suggestionId);
      setManualValues((current) => ({
        ...current,
        [suggestionId]: finalValue ?? suggestedValue,
      }));
    },
    []
  );

  const transcriptMetaLine = `${sessionTypeLabel(conversation.session?.type)} / ${conversation.student?.name ?? "生徒"} / ${transcriptLabel(conversation)}`;

  return (
    <div className={styles.page}>
      {error ? <div className={styles.errorBanner}>{error}</div> : null}

      <section className={styles.summaryGrid}>
        <Card title="信頼判断" subtitle={reviewSummary}>
          <div className={styles.summaryStatusRow}>
            <Badge
              label={transcriptReviewStateLabel(conversation.reviewState)}
              tone={transcriptReviewTone(conversation.reviewState, transcriptReview)}
            />
            <span className={styles.metaText}>{formatUpdatedAt(transcriptReview?.updatedAt)}</span>
          </div>
          <div className={styles.summaryNotes}>
            <span className={styles.summaryNote}>現在の本文: {transcriptMetaLine}</span>
            <span className={styles.summaryNote}>レビュー元: {transcriptReviewStateLabel(review.reviewState)}</span>
          </div>
        </Card>

        <Card title="確認状況" subtitle="固有名詞候補の処理状況">
          <div className={styles.metricGrid}>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>確認待ち</span>
              <strong>{pendingSuggestionCount}</strong>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>採用</span>
              <strong>{confirmedSuggestionCount}</strong>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>手修正</span>
              <strong>{manualSuggestionCount}</strong>
            </div>
          </div>
        </Card>

        <Card
          title="操作"
          subtitle="レビューを再計算し、最新の候補に追いつかせます。"
          action={
            <Button variant="secondary" size="small" onClick={() => void refreshAll()} disabled={refreshing}>
              更新
            </Button>
          }
        >
          <div className={styles.actionStack}>
            <Button onClick={() => void runReview()} disabled={refreshing}>
              {refreshing ? "更新中..." : "レビューを再生成"}
            </Button>
            <Link href="/app/logs" className={styles.backLink}>
              ログ一覧へ戻る
            </Link>
          </div>
        </Card>
      </section>

      <section className={styles.mainGrid}>
        <Card
          title="本文"
          subtitle="レビュー結果があれば reviewedText、なければ rawText をそのまま表示します。"
        >
          <div className={styles.transcriptMeta}>
            <Badge
              label={transcriptReviewStateLabel(review.reviewState)}
              tone={
                review.reviewState === "REQUIRED"
                  ? "high"
                  : review.reviewState === "RESOLVED"
                    ? "low"
                    : "neutral"
              }
            />
            <span className={styles.metaText}>{reviewSummary}</span>
          </div>
          <div className={styles.textPanel}>
            <StructuredMarkdown
              markdown={reviewText}
              emptyMessage="まだ文字起こし本文はありません。"
            />
          </div>
        </Card>

        <Card
          title="固有名詞候補"
          subtitle="採用・却下・手修正でレビューを詰めます。"
          action={<Badge label={`${review.suggestions.length}件`} tone={review.suggestions.length > 0 ? "medium" : "neutral"} />}
        >
          {review.suggestions.length === 0 ? (
            <div className={styles.emptyState}>
              まだ候補がありません。レビューを再生成すると、固有名詞の提案を作り直せます。
            </div>
          ) : (
            <div className={styles.suggestionList}>
              {review.suggestions.map((suggestion) => {
                const isEditing = editingSuggestionId === suggestion.id;
                const manualValue = manualValues[suggestion.id] ?? suggestion.finalValue ?? suggestion.suggestedValue;
                return (
                  <article key={suggestion.id} className={styles.suggestionCard}>
                    <div className={styles.suggestionHeader}>
                      <div className={styles.suggestionTitleBlock}>
                        <div className={styles.suggestionTitle}>{suggestion.rawValue}</div>
                        <div className={styles.suggestionArrow}>→</div>
                        <div className={styles.suggestionValue}>{suggestion.suggestedValue}</div>
                      </div>
                      <Badge
                        label={STATUS_LABEL[suggestion.status]}
                        tone={STATUS_TONE[suggestion.status]}
                      />
                    </div>

                    <p className={styles.suggestionReason}>{suggestion.reason}</p>

                    <div className={styles.suggestionMetaRow}>
                      <span className={styles.metaText}>{SOURCE_LABEL[suggestion.source] ?? suggestion.source}</span>
                      <span className={styles.metaText}>信頼度 {suggestion.confidence}/100</span>
                      {suggestion.partType ? (
                        <span className={styles.metaText}>{PART_TYPE_LABEL[suggestion.partType] ?? suggestion.partType}</span>
                      ) : null}
                    </div>

                    {isEditing ? (
                      <div className={styles.manualEditor}>
                        <input
                          className={styles.manualInput}
                          value={manualValue}
                          onChange={(event) =>
                            setManualValues((current) => ({
                              ...current,
                              [suggestion.id]: event.target.value,
                            }))
                          }
                          aria-label={`${suggestion.rawValue} の修正値`}
                        />
                        <div className={styles.actionRow}>
                          <Button
                            size="small"
                            variant="secondary"
                            onClick={() => {
                              setEditingSuggestionId(null);
                              setManualValues((current) => {
                                const next = { ...current };
                                delete next[suggestion.id];
                                return next;
                              });
                            }}
                            disabled={savingSuggestionId === suggestion.id}
                          >
                            戻る
                          </Button>
                          <Button
                            size="small"
                            onClick={() =>
                              void updateSuggestion(suggestion.id, {
                                status: "MANUALLY_EDITED",
                                finalValue: manualValue.trim(),
                              })
                            }
                            disabled={savingSuggestionId === suggestion.id || !manualValue.trim()}
                          >
                            {savingSuggestionId === suggestion.id ? "保存中..." : "保存する"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className={styles.actionRow}>
                        <Button
                          size="small"
                          variant="secondary"
                          onClick={() =>
                            void updateSuggestion(suggestion.id, {
                              status: "CONFIRMED",
                              finalValue: suggestion.finalValue ?? suggestion.suggestedValue,
                            })
                          }
                          disabled={savingSuggestionId === suggestion.id}
                        >
                          採用
                        </Button>
                        <Button
                          size="small"
                          variant="ghost"
                          onClick={() => void updateSuggestion(suggestion.id, { status: "REJECTED" })}
                          disabled={savingSuggestionId === suggestion.id}
                        >
                          却下
                        </Button>
                        <Button
                          size="small"
                          variant="secondary"
                          onClick={() => startManualEdit(suggestion.id, suggestion.suggestedValue, suggestion.finalValue)}
                          disabled={savingSuggestionId === suggestion.id}
                        >
                          手修正
                        </Button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </Card>
      </section>

      <Card
        title="レビュー理由"
        subtitle="なぜこのログが要確認なのかを、短い根拠で見せます。"
      >
        {transcriptReview?.reasons?.length ? (
          <div className={styles.reasonGrid}>
            {transcriptReview.reasons.map((reason) => (
              <div key={reason.code} className={styles.reasonCard}>
                <div className={styles.reasonCode}>{reason.code}</div>
                <p className={styles.reasonMessage}>{reason.message}</p>
                {typeof reason.count === "number" ? <span className={styles.metaText}>{reason.count}件</span> : null}
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            追加の理由はありません。候補の採用状況がそのまま信頼判断になります。
          </div>
        )}
      </Card>
    </div>
  );
}
