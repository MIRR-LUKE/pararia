import React from "react";
import clsx from "clsx";
import styles from "./Tabs.module.css";

type TabItem = {
  key: string;
  label: React.ReactNode;
};

type TabsProps = {
  items: TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
};

export function Tabs({ items, activeKey, onChange }: TabsProps) {
  return (
    <div className={styles.tabs} role="tablist" aria-label="表示切り替え">
      {items.map((item) => (
        <button
          type="button"
          key={item.key}
          onClick={() => onChange(item.key)}
          role="tab"
          aria-selected={item.key === activeKey}
          className={clsx(styles.tab, item.key === activeKey && styles.active)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
