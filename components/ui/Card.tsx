import React from "react";
import styles from "./Card.module.css";

type CardProps = {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
};

export function Card({ title, subtitle, action, children }: CardProps) {
  return (
    <div className={styles.card}>
      {(title || subtitle || action) && (
        <div className={styles.header}>
          <div>
            {title && <h3 className={styles.title}>{title}</h3>}
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
