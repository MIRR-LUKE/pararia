"use client";

import { Button } from "@/components/ui/Button";
import type { TeacherAppDeviceSession } from "@/lib/teacher-app/types";
import styles from "../teacher.module.css";

type Props = {
  session: TeacherAppDeviceSession;
  children: React.ReactNode;
  onLogout: () => void;
};

export function TeacherShell({ session, children, onLogout }: Props) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>PARARIA Teacher App</div>
          <h1 className={styles.title}>面談録音</h1>
          <p className={styles.subtitle}>
            {session.deviceLabel} / {session.roleLabel}
          </p>
        </div>
        <Button variant="ghost" size="small" onClick={onLogout}>
          端末を解除
        </Button>
      </header>
      <section className={styles.screen}>{children}</section>
    </div>
  );
}
