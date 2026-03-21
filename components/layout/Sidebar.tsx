"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import styles from "./Sidebar.module.css";

type NavItem = {
  label: string;
  href: string;
  iconClass: string;
};

const navItems: NavItem[] = [
  { label: "ダッシュボード", href: "/app/dashboard", iconClass: "dashboardIcon" },
  { label: "生徒一覧", href: "/app/students", iconClass: "studentsIcon" },
  { label: "システム設定", href: "/app/settings", iconClass: "settingsIcon" },
];

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  if (href === "/app/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function roleLabel(role?: string) {
  if (role === "ADMIN") return "管理者";
  if (role === "MANAGER") return "マネージャー";
  if (role === "TEACHER") return "講師";
  if (role === "INSTRUCTOR") return "授業担当";
  return "スタッフ";
}

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const userName = session?.user?.name ?? "PARARIA スタッフ";
  const role = (session?.user as any)?.role;
  const avatarText = userName.replace(/\s+/g, "").slice(0, 2) || "担";

  return (
    <aside className={styles.sidebar}>
      <div className={styles.shell}>
        <div className={styles.topSection}>
          <div className={styles.brandRow}>
            <div className={styles.brandBubble} aria-hidden>
              <span />
              <span />
              <span />
            </div>
            <button type="button" className={styles.campusButton}>
              <span>渋谷校</span>
              <span className={styles.campusArrow} aria-hidden>
                ▾
              </span>
            </button>
          </div>

          <div className={styles.searchBox} aria-label="生徒名検索">
            <span className={styles.searchIcon} aria-hidden />
            <span className={styles.searchPlaceholder}>生徒名検索</span>
          </div>

          <nav className={styles.menu} aria-label="主ナビゲーション">
            {navItems.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${styles.item} ${active ? styles.active : ""}`}
                >
                  <span className={`${styles.itemIcon} ${styles[item.iconClass]}`} aria-hidden />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className={styles.userCard}>
          <div className={styles.userAvatar}>{avatarText}</div>
          <div className={styles.userText}>
            <div className={styles.userName}>{userName}</div>
            <div className={styles.userMeta}>{roleLabel(role)}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
