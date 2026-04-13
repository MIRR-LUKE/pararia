"use client";

import { useRef, memo } from "react";
import { Button } from "@/components/ui/Button";
import {
  AUDIO_UPLOAD_ACCEPT_ATTR,
  AUDIO_UPLOAD_EXTENSIONS_LABEL,
} from "@/lib/audio-upload-support";
import type { PendingRecordingDraft } from "./studentSessionConsoleTypes";
import { formatBytes } from "./studentSessionConsoleUtils";
import styles from "./studentSessionConsole.module.css";

type Props = {
  canUpload: boolean;
  pendingDraft: PendingRecordingDraft | null;
  pendingDraftPersistence: "durable" | "memory" | null;
  pendingDraftCanUpload: boolean;
  error: string | null;
  recoverableSessionId: string | null;
  createdConversationId: string | null;
  message: string;
  state: "idle" | "preparing" | "recording" | "uploading" | "processing" | "success" | "error";
  onSelectFile: (file: File | null) => void;
  onRetryPendingDraft: () => void;
  onDownloadPendingDraft: () => void;
  onDiscardPendingDraft: () => void;
  onRetryGeneration: () => void;
  onReset: () => void;
  onOpenLog: (logId: string) => void;
};

function StudentSessionConsoleUploadSectionInner({
  canUpload,
  pendingDraft,
  pendingDraftPersistence,
  pendingDraftCanUpload,
  error,
  recoverableSessionId,
  createdConversationId,
  message,
  state,
  onSelectFile,
  onRetryPendingDraft,
  onDownloadPendingDraft,
  onDiscardPendingDraft,
  onRetryGeneration,
  onReset,
  onOpenLog,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <>
      {canUpload ? (
        <>
          <div className={styles.inlineActions}>
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={!canUpload}>
              音声ファイルを選ぶ
            </Button>
          </div>
          <input
            ref={fileInputRef}
            hidden
            type="file"
            accept={AUDIO_UPLOAD_ACCEPT_ATTR}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              event.currentTarget.value = "";
              onSelectFile(file);
            }}
          />
          <div className={`${styles.supportLine} ${styles.uploadFormats}`}>
            対応拡張子: {AUDIO_UPLOAD_EXTENSIONS_LABEL}
          </div>
        </>
      ) : null}

      {pendingDraft ? (
        <div className={styles.warningBox}>
          <strong>未送信の録音データがあります</strong>
          <p>
            {new Date(pendingDraft.createdAt).toLocaleString("ja-JP")} に保存した録音です。
            {pendingDraft.durationSeconds
              ? ` 長さは約${Math.round(pendingDraft.durationSeconds)}秒、サイズは ${formatBytes(pendingDraft.sizeBytes)} です。`
              : ` サイズは ${formatBytes(pendingDraft.sizeBytes)} です。`}
            {pendingDraftPersistence === "memory"
              ? " このタブ上には残っていますが、ページを閉じると消える可能性があります。先に再送するか、端末へ保存してください。"
              : ""}
          </p>
          <div className={styles.inlineActions}>
            {pendingDraftCanUpload ? <Button onClick={onRetryPendingDraft}>一時保存した録音を再送</Button> : null}
            <Button variant="secondary" onClick={onDownloadPendingDraft}>
              端末へ保存
            </Button>
            <Button variant="secondary" onClick={onDiscardPendingDraft}>
              破棄する
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className={styles.errorBox}>
          <strong>処理に失敗しました</strong>
          <p>{error}</p>
          {recoverableSessionId ? (
            <div className={styles.inlineActions}>
              <Button onClick={onRetryGeneration}>生成を再開する</Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {state === "success" ? (
        <div className={styles.successBox}>
          <strong>保存が完了しました</strong>
          <p>{message}</p>
          <div className={styles.inlineActions}>
            {createdConversationId ? <Button onClick={() => onOpenLog(createdConversationId)}>ログを確認</Button> : null}
            <Button variant="secondary" onClick={onReset}>
              もう一度録る
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}

StudentSessionConsoleUploadSectionInner.displayName = "StudentSessionConsoleUploadSection";

export const StudentSessionConsoleUploadSection = memo(StudentSessionConsoleUploadSectionInner);
