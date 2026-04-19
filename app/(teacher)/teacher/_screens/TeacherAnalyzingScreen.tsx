"use client";

import styles from "../teacher.module.css";

type Props = {
  description: string;
};

export function TeacherAnalyzingScreen({ description }: Props) {
  return (
    <div className={styles.stack}>
      <div className={styles.statusBlock}>
        <div className={styles.statusLabel}>解析中</div>
        <p className={styles.description}>{description}</p>
      </div>
      <div className={styles.loadingDots} aria-hidden>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
