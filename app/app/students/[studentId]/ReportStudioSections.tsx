"use client";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { GenerationProgress } from "@/components/ui/GenerationProgress";
import styles from "./reportStudio.module.css";
import type { ReportStudioView } from "./roomTypes";
import type { useReportStudioController } from "./useReportStudioController";

type Controller = ReturnType<typeof useReportStudioController>;

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

export function ReportStudioHeader({
  view,
  selectedSessionCount,
}: {
  view: ReportStudioView;
  selectedSessionCount: number;
}) {
  return (
    <div className={styles.workbenchHeader}>
      <div>
        <div className={styles.eyebrow}>保護者レポート</div>
        <h3 className={styles.workbenchTitle}>
          {view === "selection" ? "選択した会話ログからレポートを作る" : view === "generated" ? "生成した下書きを確認する" : "共有前後の状態を記録する"}
        </h3>
        <p className={styles.mutedText}>未選択ログは使いません。追加候補は提案だけで、自動追加はしません。</p>
      </div>
      <Badge label={`${selectedSessionCount} 件選択中`} tone={selectedSessionCount > 0 ? "medium" : "neutral"} />
    </div>
  );
}

export function ReportStudioError({ error }: { error: string | null }) {
  return error ? <div className={styles.inlineError}>{error}</div> : null;
}

export function ReportStudioMetrics({
  quality,
  workflowLabel,
  deliveryLabel,
  selectedCount,
}: Pick<Controller, "quality" | "workflowLabel" | "deliveryLabel"> & { selectedCount: number }) {
  return (
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
        <strong>{selectedCount} 件</strong>
      </div>
    </div>
  );
}

export function ReportStudioSelectedSessions({
  selectedSessions,
  removeSelectedSession,
}: Pick<Controller, "selectedSessions" | "removeSelectedSession">) {
  return (
    <div className={styles.issueCard}>
      <div className={styles.sectionLabel}>選択中のログ</div>
      {selectedSessions.length === 0 ? (
        <div className={styles.emptyWorkbench}>コミュニケーション履歴タブでログを選ぶと、ここにまとまりが出ます。</div>
      ) : (
        <div className={styles.inlineActions}>
          {selectedSessions.map((session) => (
            <Button key={session.id} size="small" variant="secondary" onClick={() => removeSelectedSession(session.id)}>
              {new Date(session.sessionDate).toLocaleDateString("ja-JP")} / 面談 ×
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReportStudioSelectionSection({
  view,
  reportGenerationProgress,
  previewText,
  quality,
  suggestedSessions,
  selectedSessionIds,
  onSelectedSessionIdsChange,
  generateReport,
  isGenerating,
}: Pick<
  Controller,
  | "reportGenerationProgress"
  | "previewText"
  | "quality"
  | "suggestedSessions"
  | "selectedSessionIds"
  | "onSelectedSessionIdsChange"
  | "generateReport"
  | "isGenerating"
> & {
  view: ReportStudioView;
}) {
  if (view !== "selection") return null;

  return (
    <>
      {reportGenerationProgress ? <GenerationProgress progress={reportGenerationProgress} /> : null}

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
                {new Date(session.sessionDate).toLocaleDateString("ja-JP")} / 面談
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <div className={styles.issueCard}>
        <div className={styles.sectionLabel}>送付前に見ておくこと</div>
        <div className={styles.issueList}>
          {(quality.warnings.length > 0 ? quality.warnings : ["この選択で大きな警告はありません。生成内容を読んで共有可否を判断できます。"]).map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
      </div>

      <div className={styles.actionStack}>
        <Button onClick={generateReport} disabled={isGenerating || selectedSessionIds.length === 0}>
          {isGenerating ? "保護者レポートを生成中..." : "保護者レポートを生成"}
        </Button>
        <div className={styles.progressNote}>選択確認 → ログ整理 → 本文生成 → 保存反映 の順で進みます。進捗は実際の処理段階に合わせて更新します。</div>
      </div>
    </>
  );
}

export function ReportStudioSendSection({
  view,
  latestReport,
  isSending,
  recordReportAction,
  onViewChange,
}: Pick<Controller, "latestReport" | "isSending" | "recordReportAction"> & {
  view: ReportStudioView;
  onViewChange: (view: ReportStudioView) => void;
}) {
  if (view === "selection") return null;

  return (
    <>
      <div className={styles.issueCard}>
        <div className={styles.sectionLabel}>送付前チェック</div>
        <div className={styles.issueList}>
          {(latestReport?.workflowStatusLabel ? [latestReport.workflowStatusLabel] : ["本文の流れと表現だけ最後に確認してください。"]).map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
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
                void recordReportAction(latestReport.deliveryState === "failed" || latestReport.deliveryState === "bounced" ? "resent" : "sent", "email")
              }
              disabled={isSending}
            >
              {latestReport.deliveryState === "failed" || latestReport.deliveryState === "bounced" ? "再送済みとして記録" : "送信済みとして記録"}
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
    </>
  );
}

export function ReportStudioDraftSection({
  previewParagraphs,
  selectedSessions,
  studentName,
  onOpenLog,
}: Pick<Controller, "previewParagraphs" | "selectedSessions" | "onOpenLog"> & { studentName: string }) {
  return (
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
                  const logId = selectedSessions[index]?.conversation?.id ?? selectedSessions[0]?.conversation?.id;
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
  );
}

export function ReportStudioHistorySection({ shareHistory }: Pick<Controller, "shareHistory">) {
  return (
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
  );
}
