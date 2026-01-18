import styles from "./BarChart.module.css";

type Bar = { label: string; value: number; color?: string };

export function BarChart({ data }: { data: Bar[] }) {
  if (!data.length) return null;
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div>
      <div className={styles.wrapper}>
        {data.map((item) => (
          <div
            key={item.label}
            className={styles.bar}
            style={{
              height: `${(item.value / max) * 140 + 20}px`,
              background: item.color,
            }}
          >
            <span className={styles.value}>{item.value}</span>
          </div>
        ))}
      </div>
      <div className={styles.label}>
        {data.map((item) => (
          <div key={item.label} className={styles.labelItem}>
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}
