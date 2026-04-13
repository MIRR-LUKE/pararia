"use client";

import { useEffect } from "react";
import { ReportsStatePanel } from "./ReportsStatePanel";
import styles from "./reportDashboard.module.css";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ReportsError({ error, reset }: Props) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className={styles.page}>
      <ReportsStatePanel
        kind="error"
        title="保護者レポートを表示できませんでした"
        subtitle="一覧の再構築に失敗しました。状態を取り直してから、もう一度ひらいてください。"
        action={
          <button type="button" className={styles.retryButton} onClick={reset}>
            再読み込み
          </button>
        }
      />
    </div>
  );
}
