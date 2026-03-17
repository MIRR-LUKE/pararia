"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import styles from "./Sidebar.module.css";

const navItems = [
  { label: "Today", href: "/app/dashboard" },
  { label: "Students", href: "/app/students" },
  { label: "Admin", href: "/app/settings" },
];

type StudentSummary = {
  sessions?: Array<{ status: string; pendingEntityCount: number }>;
  reports?: Array<{ status: string }>;
};

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  if (href === "/app/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [students, setStudents] = useState<StudentSummary[]>([]);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/students?limit=80", { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? "queue load failed");
        if (!cancelled) setStudents(body.students ?? []);
      })
      .catch(() => {
        if (!cancelled) setStudents([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const queueSummary = useMemo(() => {
    return students.reduce(
      (acc, student) => {
        const latestSession = student.sessions?.[0];
        const latestReport = student.reports?.[0];
        if (latestSession?.status === "PROCESSING" || latestSession?.status === "COLLECTING") acc.processing += 1;
        if ((latestSession?.pendingEntityCount ?? 0) > 0) acc.review += 1;
        if (!latestReport || latestReport.status !== "SENT") acc.pending += 1;
        return acc;
      },
      { processing: 0, review: 0, pending: 0 }
    );
  }, [students]);

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brandBlock}>
        <div className={styles.brandMark}>P</div>
        <div>
          <div className={styles.brandName}>PARARIA</div>
          <div className={styles.brandSub}>Teaching OS</div>
        </div>
      </div>

      <div className={styles.switcher}>
        <div className={styles.switcherLabel}>校舎</div>
        <button type="button" className={styles.switcherButton}>
          <span>PARARIA 本校</span>
          <span aria-hidden>⌄</span>
        </button>
      </div>

      <nav className={styles.menu} aria-label="主要ナビゲーション">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`${styles.item} ${isActive(pathname, item.href) ? styles.active : ""}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <Link href="/app/reports" className={styles.queueCard}>
        <div className={styles.queueHead}>
          <div className={styles.queueTitle}>Queue</div>
          <span className={styles.queueLink}>確認面</span>
        </div>
        <div className={styles.queueMetrics}>
          <div>
            <span className={styles.queueLabel}>処理中</span>
            <strong>{queueSummary.processing}</strong>
          </div>
          <div>
            <span className={styles.queueLabel}>要確認</span>
            <strong>{queueSummary.review}</strong>
          </div>
          <div>
            <span className={styles.queueLabel}>送付待ち</span>
            <strong>{queueSummary.pending}</strong>
          </div>
        </div>
      </Link>

      <div className={styles.footer}>
        <div className={styles.userBlock}>
          <div className={styles.userName}>{session?.user?.name ?? "Staff"}</div>
          <div className={styles.userMeta}>{(session?.user as any)?.role ?? "TEACHER"}</div>
        </div>
        <button
          type="button"
          className={styles.signOut}
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          ログアウト
        </button>
      </div>
    </aside>
  );
}