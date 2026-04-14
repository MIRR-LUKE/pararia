"use client";

import { memo } from "react";
import styles from "./studentSessionConsole.module.css";

type Props = {
  lockConflict: boolean;
  lockConflictName: string;
};

function StudentSessionConsoleLockSectionInner({ lockConflict, lockConflictName }: Props) {
  if (!lockConflict) return null;

  return (
    <div className={styles.warningBox}>
      <strong>他の担当者が録音中です</strong>
      <p>{lockConflictName} がこの生徒で録音中です。終了後に開始してください。</p>
    </div>
  );
}

StudentSessionConsoleLockSectionInner.displayName = "StudentSessionConsoleLockSection";

export const StudentSessionConsoleLockSection = memo(StudentSessionConsoleLockSectionInner);
