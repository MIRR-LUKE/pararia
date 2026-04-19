"use client";

import { Button } from "@/components/ui/Button";
import styles from "../teacher.module.css";

type SupportTone = "ready" | "warning" | "danger";

type Props = {
  canStartRecording: boolean;
  microphoneDescription: string | null;
  microphoneTitle: string | null;
  microphoneTone: SupportTone;
  microphoneStatusLabel: string;
  unsentCount: number;
  onRefreshMicrophone: () => void;
  onOpenPending: () => void;
  onOpenRecordingPreview: () => void;
};

function getToneClassName(tone: SupportTone) {
  if (tone === "danger") return styles.metaPillDanger;
  if (tone === "warning") return styles.metaPillWarning;
  return styles.metaPillReady;
}

function getSupportCardClassName(tone: SupportTone) {
  if (tone === "danger") return styles.supportCardDanger;
  return styles.supportCardWarning;
}

export function TeacherStandbyScreen({
  canStartRecording,
  microphoneDescription,
  microphoneStatusLabel,
  microphoneTitle,
  microphoneTone,
  unsentCount,
  onRefreshMicrophone,
  onOpenPending,
  onOpenRecordingPreview,
}: Props) {
  return (
    <div className={styles.stack}>
      <div className={styles.statusBlock}>
        <div className={styles.statusLabel}>待機中</div>
        <p className={styles.description}>面談の準備ができたら、ここから始めます。</p>
      </div>
      {microphoneTitle && microphoneDescription ? (
        <div className={[styles.supportCard, getSupportCardClassName(microphoneTone)].join(" ")}>
          <div className={styles.supportCardTitle}>{microphoneTitle}</div>
          <p className={styles.supportCardDescription}>{microphoneDescription}</p>
          <div className={styles.supportCardActions}>
            <Button variant="secondary" size="small" onClick={onRefreshMicrophone}>
              状態を更新
            </Button>
          </div>
        </div>
      ) : null}
      <Button className={styles.heroButton} disabled={!canStartRecording} onClick={onOpenRecordingPreview}>
        録音開始
      </Button>
      <div className={styles.metaRow}>
        <div className={styles.metaPills}>
          <span className={styles.metaPill}>接続は正常です</span>
          <span className={[styles.metaPill, getToneClassName(microphoneTone)].join(" ")}>{microphoneStatusLabel}</span>
        </div>
        <button type="button" className={styles.linkButton} onClick={onOpenPending}>
          未送信 {unsentCount} 件
        </button>
      </div>
    </div>
  );
}
