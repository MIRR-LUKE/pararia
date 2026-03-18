"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import styles from "./Sidebar.module.css";

const navItems = [
  { label: "概要", href: "/app/dashboard" },
  { label: "生徒一覧", href: "/app/students" },
  { label: "設定", href: "/app/settings" },
];

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  if (href === "/app/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = (session?.user as any)?.role;
  const roleLabel = role === "ADMIN" ? "管理者" : role === "TEACHER" ? "講師" : "担当者";

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brandBlock}>
        <div className={styles.brandMark}>P</div>
        <div>
          <div className={styles.brandName}>PARARIA</div>
          <div className={styles.brandSub}>指導運用 OS</div>
        </div>
      </div>

      <div className={styles.switcher}>
        <div className={styles.switcherLabel}>校舎</div>
        <button type="button" className={styles.switcherButton}>
          <span>PARARIA 本校</span>
          <span aria-hidden>∨</span>
        </button>
      </div>

      <nav className={styles.menu} aria-label="主ナビゲーション">
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

      <div className={styles.footer}>
        <div className={styles.userBlock}>
          <div className={styles.userName}>{session?.user?.name ?? "PARARIA スタッフ"}</div>
          <div className={styles.userMeta}>{roleLabel}</div>
        </div>
        <button type="button" className={styles.signOut} onClick={() => signOut({ callbackUrl: "/login" })}>
          ログアウト
        </button>
      </div>
    </aside>
  );
}
