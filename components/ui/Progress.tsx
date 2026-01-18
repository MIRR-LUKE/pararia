import styles from "./Progress.module.css";

export function Progress({ value }: { value: number }) {
  const safe = Math.min(Math.max(value, 0), 100);
  return (
    <div className={styles.wrapper} aria-valuenow={safe} role="progressbar">
      <div className={styles.bar} style={{ width: `${safe}%` }} />
    </div>
  );
}
