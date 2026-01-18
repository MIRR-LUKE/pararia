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
    <div className={styles.tabs}>
      {items.map((item) => (
        <button
          key={item.key}
          onClick={() => onChange(item.key)}
          className={clsx(styles.tab, item.key === activeKey && styles.active)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
