"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import styles from "./logsList.module.css";

type Props = {
  logId: string;
  title: string;
};

export default function DeleteLogButton({ logId, title }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const deleteLog = async () => {
    setPending(true);
    try {
      const res = await fetch(`/api/conversations/${logId}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error ?? "ログの削除に失敗しました。");
      }

      setOpen(false);
      router.refresh();
    } catch (error: any) {
      window.alert(error?.message ?? "ログの削除に失敗しました。");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="small"
        className={styles.deleteButton}
        onClick={() => setOpen(true)}
      >
        削除
      </Button>

      <ConfirmDialog
        open={open}
        title={title}
        description="削除したログ本文と文字起こしは元に戻せません。保護者レポートで参照中なら source trace からも外れます。"
        details={[
          "削除後は一覧から即時に消えます。",
          "必要なら削除前に内容を確認してください。",
        ]}
        confirmLabel="削除する"
        cancelLabel="戻る"
        tone="danger"
        pending={pending}
        onConfirm={() => void deleteLog()}
        onCancel={() => {
          if (pending) return;
          setOpen(false);
        }}
      />
    </>
  );
}
