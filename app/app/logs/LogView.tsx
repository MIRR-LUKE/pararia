"use client";

import { LogViewErrorState, LogViewHeader, LogViewLoadingState, LogViewSummarySection, LogViewTabs, LogViewTranscriptSection, LogViewTrustPanel } from "./LogViewSections";
import { useLogViewController } from "./useLogViewController";
import styles from "./[logId]/logView.module.css";

type Props = {
  logId: string;
  showHeader?: boolean;
  onBack?: () => void;
  onSaved?: () => Promise<void> | void;
  onDirtyChange?: (dirty: boolean) => void;
};

export function LogView({ logId, showHeader = true, onBack, onSaved, onDirtyChange }: Props) {
  const controller = useLogViewController({ logId, onSaved, onDirtyChange });
  const { log, loading, error, tab, setTab, fetchLog } = controller;

  if (loading) {
    return <LogViewLoadingState />;
  }

  if (error || !log) {
    return <LogViewErrorState error={error} onRetry={() => void fetchLog()} onBack={onBack} />;
  }

  return (
    <section className={styles.page}>
      <LogViewHeader log={log} showHeader={showHeader} onBack={onBack} />
      <LogViewTrustPanel
        log={log}
        transcriptReview={controller.transcriptReview}
        transcriptReviewStateLabel={controller.transcriptReviewStateLabel}
        transcriptReviewSummary={controller.transcriptReviewSummary}
        transcriptReviewTone={controller.transcriptReviewTone}
      />
      <LogViewTabs tab={tab} setTab={setTab} />

      {log.status === "PROCESSING" ? <div className={styles.progressBanner}>生成途中のため自動で更新しています。ログ本文ができしだい表示されます。</div> : null}

      {tab === "summary" ? (
        <LogViewSummarySection {...controller} />
      ) : null}

      {tab === "transcript" ? <LogViewTranscriptSection transcriptText={controller.transcriptText} /> : null}
    </section>
  );
}
