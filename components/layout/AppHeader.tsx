"use client";

import styles from "./AppHeader.module.css";

type Props = {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  viewerName?: string | null;
  viewerRole?: string | null;
};

function roleLabel(role?: string | null) {
  if (role === "ADMIN") return "管理者";
  if (role === "MANAGER") return "マネージャー";
  if (role === "TEACHER") return "講師";
  if (role === "INSTRUCTOR") return "担当者";
  return "スタッフ";
}

export function AppHeader({ title, subtitle, actions, viewerName, viewerRole }: Props) {
  const initials = (viewerName ?? "担当").replace(/\s+/g, "").slice(0, 2) || "担当";

  return (
    <header className={styles.header}>
      <div className={styles.copy}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </div>
      <div className={styles.actions}>
        {actions}
        <div className={styles.user}>
          <div className={styles.avatar}>{initials}</div>
          <div>
            <div className={styles.userName}>{viewerName ?? "PARARIA スタッフ"}</div>
            <div className={styles.userMeta}>{roleLabel(viewerRole)}</div>
          </div>
        </div>
      </div>
    </header>
  );
}

export function AppHeaderUserOnly({ title, subtitle, viewerName, viewerRole }: Props) {
  return <AppHeader title={title} subtitle={subtitle} viewerName={viewerName} viewerRole={viewerRole} />;
}
