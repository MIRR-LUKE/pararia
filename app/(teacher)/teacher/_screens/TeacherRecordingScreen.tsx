"use client";

import { Button } from "@/components/ui/Button";
import { formatRecordingTime } from "@/lib/teacher-app/recording-utils";
import styles from "../teacher.module.css";

type Props = {
  seconds: number;
  onCancel: () => void;
  onStop: () => void;
};

export function TeacherRecordingScreen({ seconds, onCancel, onStop }: Props) {
  return (
    <div className={styles.stack}>
      <div className={styles.statusBlock}>
        <div className={styles.statusLabel}>録音中</div>
        <div className={styles.timer}>{formatRecordingTime(seconds)}</div>
      </div>
      <Button className={styles.heroButton} onClick={onStop}>
        録音終了
      </Button>
      <Button variant="secondary" className={styles.secondaryButton} onClick={onCancel}>
        中止
      </Button>
    </div>
  );
}
