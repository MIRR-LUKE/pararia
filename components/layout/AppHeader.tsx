"use client";

import { useSession } from "next-auth/react";
import styles from "./AppHeader.module.css";

type Props = {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
};

export function AppHeader({ title, subtitle, actions }: Props) {
  const { data: session } = useSession();
  const initials = (session?.user?.name || "P").slice(0, 1).toUpperCase();

  return (
    <header className={styles.header}>
      <div>
        <h1 className={styles.title}>{title}</h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      <div className={styles.actions}>
        {actions}
        <div className={styles.user}>
          <div className={styles.avatar}>{initials}</div>
          <div>
            <div style={{ fontWeight: 700 }}>{session?.user?.name ?? "Staff"}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              {(session?.user as any)?.role ?? "TEACHER"}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

export function AppHeaderUserOnly({ title, subtitle }: Props) {
  return <AppHeader title={title} subtitle={subtitle} />;
}
