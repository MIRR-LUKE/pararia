"use client";

import { Button } from "@/components/ui/Button";
import type { PendingTeacherUploadItem } from "@/lib/teacher-app/types";
import styles from "../teacher.module.css";

type Props = {
  busyId: string | null;
  items: PendingTeacherUploadItem[];
  onBack: () => void;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
};

export function TeacherPendingListScreen({ busyId, items, onBack, onDelete, onRetry }: Props) {
  return (
    <div className={styles.stack}>
      <div className={styles.statusBlock}>
        <div className={styles.statusLabel}>未送信一覧</div>
        <p className={styles.description}>送れなかった録音だけ、ここに並びます。</p>
      </div>
      {items.length === 0 ? (
        <div className={styles.emptyState}>未送信はありません。</div>
      ) : (
        <div className={styles.pendingList}>
          {items.map((item) => (
            <div key={item.id} className={styles.pendingCard}>
              <strong>{item.label}</strong>
              <span>{item.recordedAt}</span>
              {item.errorMessage ? <span>{item.errorMessage}</span> : null}
              <div className={styles.pendingActions}>
                <Button
                  variant="secondary"
                  className={styles.pendingActionButton}
                  disabled={busyId === item.id}
                  onClick={() => onRetry(item.id)}
                >
                  {busyId === item.id ? "再送中..." : "再送"}
                </Button>
                <Button
                  variant="ghost"
                  className={styles.pendingActionButton}
                  disabled={busyId === item.id}
                  onClick={() => onDelete(item.id)}
                >
                  削除
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Button variant="secondary" className={styles.secondaryButton} onClick={onBack}>
        戻る
      </Button>
    </div>
  );
}
