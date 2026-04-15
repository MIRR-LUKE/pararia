"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";
import { buildUnsupportedAudioUploadErrorMessage, isSupportedAudioUpload } from "@/lib/audio-upload-support";
import type { ConsoleState, PendingRecordingDraft, SessionConsoleMode, UploadSource } from "./studentSessionConsoleTypes";
import { getDurationValidationMessage, readAudioDurationSeconds } from "./studentSessionConsoleUtils";

type Params = {
  clearPendingDraftState: () => Promise<void>;
  lockConflict: unknown;
  lockConflictName: string;
  mode: SessionConsoleMode;
  pendingDraft: PendingRecordingDraft | null;
  setCreatedConversationId: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setShowDiscardDraftDialog: Dispatch<SetStateAction<boolean>>;
  setState: Dispatch<SetStateAction<ConsoleState>>;
  state: ConsoleState;
  uploadAudioFile: (file: File, uploadSource?: UploadSource, durationSecondsHint?: number | null) => Promise<void>;
};

export function useStudentSessionConsoleDraftActions({
  clearPendingDraftState,
  lockConflict,
  lockConflictName,
  mode,
  pendingDraft,
  setCreatedConversationId,
  setError,
  setMessage,
  setShowDiscardDraftDialog,
  setState,
  state,
  uploadAudioFile,
}: Params) {
  const handleFileSelection = useCallback(
    async (file: File | null) => {
      if (!file) return;
      if (!isSupportedAudioUpload({ fileName: file.name, mimeType: file.type })) {
        setState("error");
        setError(buildUnsupportedAudioUploadErrorMessage());
        return;
      }
      if (lockConflict) {
        setState("error");
        setError(`${lockConflictName} が録音中です。終了後に開始してください。`);
        return;
      }
      const durationSeconds = await readAudioDurationSeconds(file);
      const durationMessage = getDurationValidationMessage(mode, durationSeconds);
      if (durationMessage) {
        setState("error");
        setError(durationMessage);
        return;
      }
      setCreatedConversationId(null);
      await uploadAudioFile(file, "file_upload", durationSeconds);
    },
    [lockConflict, lockConflictName, mode, setCreatedConversationId, setError, setState, uploadAudioFile]
  );

  const retryPendingDraftUpload = useCallback(async () => {
    if (!pendingDraft) return;
    setError(null);
    setMessage("一時保存した録音を再送しています。");
    await uploadAudioFile(pendingDraft.file, "direct_recording", pendingDraft.durationSeconds);
  }, [pendingDraft, setError, setMessage, uploadAudioFile]);

  const discardPendingDraft = useCallback(async () => {
    setShowDiscardDraftDialog(false);
    await clearPendingDraftState();
    setError(null);
    setMessage("一時保存していた録音データを破棄しました。");
    if (state === "error") {
      setState("idle");
    }
  }, [clearPendingDraftState, setError, setMessage, setShowDiscardDraftDialog, setState, state]);

  return {
    discardPendingDraft,
    handleFileSelection,
    retryPendingDraftUpload,
  };
}
