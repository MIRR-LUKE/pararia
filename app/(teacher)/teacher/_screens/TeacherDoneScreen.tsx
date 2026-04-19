"use client";

import { useEffect } from "react";
import styles from "../teacher.module.css";

type Props = {
  description: string;
  onBack: () => void;
  title: string;
};

export function TeacherDoneScreen({ description, onBack, title }: Props) {
  useEffect(() => {
    const timer = window.setTimeout(onBack, 2500);
    return () => window.clearTimeout(timer);
  }, [onBack]);

  return (
    <div className={styles.stack}>
      <div className={styles.statusBlock}>
        <div className={styles.statusLabel}>{title}</div>
        <p className={styles.description}>{description}</p>
      </div>
    </div>
  );
}
