"use client";

import { Button } from "@/components/ui/Button";
import styles from "../teacher.module.css";

type Props = {
  seconds: number;
  onStop: () => void;
};

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function TeacherRecordingScreen({ seconds, onStop }: Props) {
  return (
    <div className={styles.stack}>
      <div className={styles.statusBlock}>
        <div className={styles.statusLabel}>録音中</div>
        <div className={styles.timer}>{formatTime(seconds)}</div>
      </div>
      <Button className={styles.heroButton} onClick={onStop}>
        録音終了
      </Button>
      <p className={styles.helper}>終了すると、次の確認へ進みます。</p>
    </div>
  );
}
