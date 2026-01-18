import { DEFAULT_TEACHER_FULL_NAME } from "@/lib/constants";
import styles from "./AppHeader.module.css";

type Props = {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
};

export function AppHeader({ title, subtitle, actions }: Props) {
  return (
    <header className={styles.header}>
      <div>
        <h1 className={styles.title}>{title}</h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      <div className={styles.actions}>
        {actions}
        <div className={styles.user}>
          <div className={styles.avatar}>A</div>
          <div>
            <div style={{ fontWeight: 700 }}>{DEFAULT_TEACHER_FULL_NAME}（講師）</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>本校舎</div>
          </div>
        </div>
      </div>
    </header>
  );
}

// backward compatibility
export function AppHeaderUserOnly({ title, subtitle }: Props) {
  return (
    <header className={styles.header}>
      <div>
        <h1 className={styles.title}>{title}</h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      <div className={styles.user}>
        <div className={styles.avatar}>A</div>
        <div>
          <div style={{ fontWeight: 700 }}>{DEFAULT_TEACHER_FULL_NAME}（講師）</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>本校舎</div>
        </div>
      </div>
    </header>
  );
}
