import clsx from "clsx";
import styles from "./Badge.module.css";

type BadgeProps = {
  label: string;
  tone?: "neutral" | "low" | "medium" | "high";
};

export function Badge({ label, tone = "neutral" }: BadgeProps) {
  return <span className={clsx(styles.badge, styles[tone])}>{label}</span>;
}
