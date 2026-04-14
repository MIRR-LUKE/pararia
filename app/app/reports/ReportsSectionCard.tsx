import type React from "react";
import styles from "./ReportsSectionCard.module.css";

type Props = {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
};

export function ReportsSectionCard({ title, subtitle, action, children }: Props) {
  return (
    <section className={styles.card}>
      {(title || subtitle || action) && (
        <div className={styles.header}>
          <div>
            {title ? <h3 className={styles.title}>{title}</h3> : null}
            {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
          </div>
          {action ? <div className={styles.action}>{action}</div> : null}
        </div>
      )}
      {children}
    </section>
  );
}
