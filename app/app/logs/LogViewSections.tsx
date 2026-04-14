"use client";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StatePanel } from "@/components/ui/StatePanel";
import { StructuredMarkdown } from "@/components/ui/StructuredMarkdown";
import styles from "./[logId]/logView.module.css";
import type { ConversationStatus, TabKey } from "./useLogViewController";
import { useLogViewController } from "./useLogViewController";

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

type LogViewController = ReturnType<typeof useLogViewController>;

export function LogViewLoadingState() {
  return <StatePanel kind="processing" compact title="ログを読み込んでいます" subtitle="要約と文字起こしを準備しています。" />;
}

export function LogViewErrorState({
  error,
  onRetry,
  onBack,
}: {
  error: string | null;
  onRetry: () => void;
  onBack?: () => void;
}) {
  return (
    <StatePanel
      kind="error"
      title="ログを読み込めませんでした"
      subtitle={error ?? "時間をおいてから、もう一度読み直してください。"}
      action={
        <div className={styles.inlineActions}>
          <Button variant="secondary" onClick={onRetry}>
            もう一度読む
          </Button>
          {onBack ? <Button onClick={onBack}>閉じる</Button> : null}
        </div>
      }
    />
  );
}

export function LogViewHeader({
  log,
  showHeader = true,
  onBack,
}: {
  log: LogViewController["log"];
  showHeader?: boolean;
  onBack?: () => void;
}) {
  if (!showHeader || !log) return null;

  return (
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
  );
}

export function LogViewTrustPanel({
  log,
  transcriptReview,
  transcriptReviewStateLabel,
  transcriptReviewSummary,
  transcriptReviewTone,
}: Pick<
  LogViewController,
  "log" | "transcriptReview" | "transcriptReviewStateLabel" | "transcriptReviewSummary" | "transcriptReviewTone"
>) {
  if (!log) return null;

  return (
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
  );
}

export function LogViewTabs({ tab, setTab }: Pick<LogViewController, "tab" | "setTab">) {
  return (
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
  );
}

export function LogViewSummarySection({
  canEditSummary,
  isDirty,
  isEditingSummary,
  isSavingSummary,
  normalizedDraftSummary,
  saveError,
  saveNotice,
  onDraftSummaryChange,
  startEditingSummary,
  stopEditingSummary,
  draftSummary,
  summaryMarkdown,
  saveSummary,
}: Pick<
  LogViewController,
  | "canEditSummary"
  | "isDirty"
  | "isEditingSummary"
  | "isSavingSummary"
  | "normalizedDraftSummary"
  | "saveError"
  | "saveNotice"
  | "onDraftSummaryChange"
  | "startEditingSummary"
  | "stopEditingSummary"
  | "draftSummary"
  | "summaryMarkdown"
  | "saveSummary"
>) {
  return (
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

      {saveError ? (
        <div className={styles.inlineError}>
          <p>{saveError}</p>
        </div>
      ) : null}
      {saveNotice ? <div className={styles.progressBanner}>{saveNotice}</div> : null}

      {isEditingSummary ? (
        <div className={styles.editorGrid}>
          <div className={styles.stack}>
            <div className={styles.sectionLabel}>編集内容</div>
            <textarea
              className={styles.summaryEditor}
              value={draftSummary}
              onChange={(event) => onDraftSummaryChange(event.target.value)}
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
  );
}

export function LogViewTranscriptSection({ transcriptText }: Pick<LogViewController, "transcriptText">) {
  return (
    <div className={styles.stack}>
      <div className={styles.contentPanel}>
        <StructuredMarkdown markdown={transcriptText} emptyMessage="まだ文字起こしはありません。" className={styles.structuredContent} />
      </div>
    </div>
  );
}
