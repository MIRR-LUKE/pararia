"use client";

import { useEffect } from "react";
import styles from "../teacher.module.css";

type Props = {
  onReady: () => void;
};

export function TeacherAnalyzingScreen({ onReady }: Props) {
  useEffect(() => {
    const timer = window.setTimeout(onReady, 1200);
    return () => window.clearTimeout(timer);
  }, [onReady]);

  return (
    <div className={styles.stack}>
      <div className={styles.statusBlock}>
        <div className={styles.statusLabel}>解析中</div>
        <p className={styles.description}>文字起こしと生徒候補を確認しています。</p>
      </div>
      <div className={styles.loadingDots} aria-hidden>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
