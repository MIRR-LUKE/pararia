"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import styles from "./logsList.module.css";

type Props = {
  logId: string;
  title: string;
  onDeleted?: () => Promise<void> | void;
};

export default function DeleteLogButton({ logId, title, onDeleted }: Props) {
  const router = useRouter();
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

      if (onDeleted) {
        await onDeleted();
      } else {
        router.refresh();
      }
    } catch (error: any) {
      window.alert(error?.message ?? "ログの削除に失敗しました。");
    } finally {
      setPending(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="small"
      className={styles.deleteButton}
      disabled={pending}
      onClick={async () => {
        const confirmed = window.confirm(
          `${title}\n\n削除したログ本文と文字起こしは元に戻せません。保護者レポートで参照中なら source trace からも外れます。`
        );
        if (!confirmed) return;
        await deleteLog();
      }}
    >
      {pending ? "処理中..." : "削除"}
    </Button>
  );
}
