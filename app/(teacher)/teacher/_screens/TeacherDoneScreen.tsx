"use client";

import { useEffect } from "react";
import styles from "../teacher.module.css";

type Props = {
  onBack: () => void;
};

export function TeacherDoneScreen({ onBack }: Props) {
  useEffect(() => {
    const timer = window.setTimeout(onBack, 2500);
    return () => window.clearTimeout(timer);
  }, [onBack]);

  return (
    <div className={styles.stack}>
      <div className={styles.statusBlock}>
        <div className={styles.statusLabel}>確認しました</div>
        <p className={styles.description}>次の録音に戻ります。</p>
      </div>
    </div>
  );
}
