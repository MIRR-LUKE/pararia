"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { IntentLink } from "@/components/ui/IntentLink";
import styles from "./Sidebar.module.css";

type NavItem = {
  label: string;
  href: string;
  iconClass: string;
};

type SidebarProps = {
  viewerName?: string | null;
  viewerRole?: string | null;
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

function roleLabel(role?: string | null) {
  if (role === "ADMIN") return "管理者";
  if (role === "MANAGER") return "マネージャー";
  if (role === "TEACHER") return "講師";
  if (role === "INSTRUCTOR") return "授業担当";
  return "スタッフ";
}

export function Sidebar({ viewerName, viewerRole }: SidebarProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const userName = viewerName ?? "PARARIA スタッフ";
  const avatarText = userName.replace(/\s+/g, "").slice(0, 2) || "担";

  useEffect(() => {
    if (!menuOpen) return;
    const timer = window.setTimeout(() => setMenuOpen(false), 0);
    return () => window.clearTimeout(timer);
  }, [menuOpen, pathname]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(min-width: 1081px)");
    const closeOnDesktop = (event?: MediaQueryListEvent) => {
      if (event ? event.matches : mediaQuery.matches) {
        setMenuOpen(false);
      }
    };
    closeOnDesktop();
    mediaQuery.addEventListener("change", closeOnDesktop);
    return () => mediaQuery.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <>
      {menuOpen ? (
        <button
          type="button"
          className={styles.backdrop}
          aria-label="メニューを閉じる"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}
      <aside className={styles.sidebar}>
        <div className={styles.shell}>
          <div className={styles.topBar}>
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

            <button
              type="button"
              className={`${styles.menuToggle} ${menuOpen ? styles.menuToggleOpen : ""}`}
              aria-label={menuOpen ? "メニューを閉じる" : "メニューを開く"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((current) => !current)}
            >
              <span />
              <span />
              <span />
            </button>
          </div>

          <div className={`${styles.drawer} ${menuOpen ? styles.drawerOpen : ""}`}>
            <div className={styles.topSection}>
              <div className={styles.searchBox} aria-label="生徒名検索">
                <span className={styles.searchIcon} aria-hidden />
                <span className={styles.searchPlaceholder}>生徒名検索</span>
              </div>

              <nav className={styles.menu} aria-label="主ナビゲーション">
                {navItems.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <IntentLink
                      key={item.href}
                      href={item.href}
                      prefetchMode={item.href === "/app/dashboard" ? "mount" : "intent"}
                      className={`${styles.item} ${active ? styles.active : ""}`}
                      onClick={() => setMenuOpen(false)}
                    >
                      <span className={`${styles.itemIcon} ${styles[item.iconClass]}`} aria-hidden />
                      <span>{item.label}</span>
                    </IntentLink>
                  );
                })}
              </nav>
            </div>

            <div className={styles.userCard}>
              <div className={styles.userAvatar}>{avatarText}</div>
              <div className={styles.userText}>
                <div className={styles.userName}>{userName}</div>
                <div className={styles.userMeta}>{roleLabel(viewerRole)}</div>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
