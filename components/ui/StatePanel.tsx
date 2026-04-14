import type { ReactNode } from "react";
import styles from "./StatePanel.module.css";

type StatePanelKind = "empty" | "error" | "processing";

type Props = {
  kind?: StatePanelKind;
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
};

const KIND_LABEL: Record<StatePanelKind, string> = {
  empty: "状態",
  error: "要確認",
  processing: "処理中",
};

function panelClassName(kind: StatePanelKind, compact: boolean) {
  return [
    styles.panel,
    kind === "error" ? styles.error : kind === "processing" ? styles.processing : styles.empty,
    compact ? styles.compact : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function StatePanel({ kind = "empty", title, subtitle, action, compact = false }: Props) {
  return (
    <div
      className={panelClassName(kind, compact)}
      role={kind === "error" ? "alert" : kind === "processing" ? "status" : "note"}
      aria-live={kind === "processing" ? "polite" : undefined}
    >
      <div className={styles.copy}>
        <div className={styles.eyebrow}>{KIND_LABEL[kind]}</div>
        <strong className={styles.title}>{title}</strong>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
