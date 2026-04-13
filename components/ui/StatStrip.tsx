import type { ReactNode } from "react";
import styles from "./StatStrip.module.css";

export type StatStripItem = {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
};

type Props = {
  items: StatStripItem[];
};

export function StatStrip({ items }: Props) {
  return (
    <section className={styles.strip}>
      {items.map((item) => (
        <div key={item.label} className={styles.item}>
          <span className={styles.label}>{item.label}</span>
          <strong className={styles.value}>{item.value}</strong>
          {item.detail ? <p className={styles.detail}>{item.detail}</p> : null}
        </div>
      ))}
    </section>
  );
}
