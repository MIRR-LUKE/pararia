"use client";

import { Button } from "@/components/ui/Button";
import styles from "../teacher.module.css";

type Props = {
  unsentCount: number;
  onOpenPending: () => void;
  onOpenRecordingPreview: () => void;
};

export function TeacherStandbyScreen({ unsentCount, onOpenPending, onOpenRecordingPreview }: Props) {
  return (
    <div className={styles.stack}>
      <div className={styles.statusBlock}>
        <div className={styles.statusLabel}>待機中</div>
        <p className={styles.description}>面談の準備ができたら、ここから始めます。</p>
      </div>
      <Button className={styles.heroButton} onClick={onOpenRecordingPreview}>
        録音開始
      </Button>
      <div className={styles.metaRow}>
        <span className={styles.metaPill}>接続は正常です</span>
        <button type="button" className={styles.linkButton} onClick={onOpenPending}>
          未送信 {unsentCount} 件
        </button>
      </div>
    </div>
  );
}
