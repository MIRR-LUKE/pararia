import type { ReactNode } from "react";
import styles from "./MetricList.module.css";

export type MetricListItem = {
  label: string;
  value: ReactNode;
};

type Props = {
  items: MetricListItem[];
  layout?: "stack" | "split";
};

export function MetricList({ items, layout = "stack" }: Props) {
  return (
    <div className={layout === "split" ? styles.splitList : styles.stackList}>
      {items.map((item) => (
        <div key={item.label} className={layout === "split" ? styles.splitItem : styles.stackItem}>
          <div className={styles.label}>{item.label}</div>
          <div className={styles.value}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}
