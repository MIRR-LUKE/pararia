import styles from "./LineChart.module.css";

type Point = { label: string; value: number };

type Props = {
  data: Point[];
};

export function LineChart({ data }: Props) {
  if (!data.length) return null;
  const width = 420;
  const height = 140;
  const padding = 12;
  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const step = (width - padding * 2) / Math.max(data.length - 1, 1);

  const points = data.map((d, index) => {
    const x = padding + step * index;
    const y = height - padding - (d.value / maxValue) * (height - padding * 2);
    return { x, y };
  });

  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");
  const areaPoints = [
    `${padding},${height - padding}`,
    polyline,
    `${padding + step * (data.length - 1)},${height - padding}`,
  ].join(" ");

  return (
    <div>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="離塾数推移"
      >
        <line
          className={styles.grid}
          x1="0"
          y1={height - padding}
          x2={width}
          y2={height - padding}
        />
        <polyline className={styles.area} points={areaPoints} />
        <polyline className={styles.polyline} points={polyline} />
        {points.map((p, idx) => (
          <circle
            key={idx}
            cx={p.x}
            cy={p.y}
            r="4"
            fill="#1d4ed8"
            stroke="#fff"
            strokeWidth="2"
          />
        ))}
      </svg>
      <div className={styles.labels}>
        {data.map((d) => (
          <span key={d.label}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}
