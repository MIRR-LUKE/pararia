import styles from "./PageLoadingState.module.css";

type Props = {
  title: string;
  subtitle: string;
  rows?: number;
};

export function PageLoadingState({ title, subtitle, rows = 3 }: Props) {
  return (
    <div className={styles.wrap} aria-live="polite" aria-busy="true" role="status" aria-label={title}>
      <div>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.subtitle}>{subtitle}</p>
      </div>
      <div className={styles.skeletonGrid}>
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className={styles.skeletonRow} />
        ))}
      </div>
    </div>
  );
}
