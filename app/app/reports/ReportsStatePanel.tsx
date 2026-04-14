"use client";

import clsx from "clsx";
import type React from "react";
import styles from "./ReportsStatePanel.module.css";

type ReportStateKind = "empty" | "processing" | "error";

type Props = {
  kind: ReportStateKind;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
  details?: React.ReactNode;
};

const kindLabel: Record<ReportStateKind, string> = {
  empty: "空状態",
  processing: "処理中",
  error: "エラー",
};

export function ReportsStatePanel({ kind, title, subtitle, action, details }: Props) {
  return (
    <section className={clsx(styles.panel, styles[kind])} aria-live={kind === "error" ? "polite" : undefined}>
      <div className={styles.copy}>
        <span className={styles.kicker}>{kindLabel[kind]}</span>
        <h3 className={styles.title}>{title}</h3>
        <p className={styles.subtitle}>{subtitle}</p>
        {details}
      </div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </section>
  );
}
