"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import styles from "./ConfirmDialog.module.css";

type Props = {
  open: boolean;
  title: string;
  description: string;
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  details = [],
  confirmLabel = "実行する",
  cancelLabel = "キャンセル",
  tone = "default",
  pending = false,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, open, pending]);

  if (!open) return null;

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) {
          onCancel();
        }
      }}
    >
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
        <div className={styles.body}>
          <div className={styles.eyebrow}>確認</div>
          <h2 id="confirm-dialog-title" className={styles.title}>
            {title}
          </h2>
          <p className={styles.description}>{description}</p>
          {details.length > 0 ? (
            <div className={styles.detailList}>
              {details.map((detail) => (
                <p key={detail} className={styles.detailItem}>
                  {detail}
                </p>
              ))}
            </div>
          ) : null}
        </div>

        <div className={styles.actions}>
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={pending}
            className={tone === "danger" ? styles.dangerButton : undefined}
          >
            {pending ? "処理中..." : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
