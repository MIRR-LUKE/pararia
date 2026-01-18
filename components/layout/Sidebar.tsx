"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./Sidebar.module.css";

const navItems = [
  { label: "ダッシュボード", href: "/app/dashboard" },
  { label: "生徒一覧", href: "/app/students" },
  { label: "保護者レポート", href: "/app/reports" },
  { label: "設定", href: "/app/settings" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <div className={styles.logo}>P</div>
        <div>
          <p className={styles.title}>PARARIA AI</p>
          <span style={{ fontSize: 12, color: "#cbd5e1" }}>学習塾ダッシュボード</span>
        </div>
      </div>
      <nav className={styles.menu}>
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`${styles.item} ${
              pathname?.startsWith(item.href) ? styles.active : ""
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className={styles.footer}>
        <div>v0.1 MVP</div>
        <div>デモ用 UI</div>
      </div>
    </aside>
  );
}
