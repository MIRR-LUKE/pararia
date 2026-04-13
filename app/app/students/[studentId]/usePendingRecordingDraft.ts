"use client";

import { useCallback, useEffect, useState } from "react";
import type { PendingRecordingDraft, SessionConsoleLessonPart, SessionConsoleMode } from "./studentSessionConsoleTypes";
import { loadPendingRecordingStoreModule, toPendingDraft } from "./studentSessionConsoleUtils";

type Params = {
  studentId: string;
  mode: SessionConsoleMode;
  lessonPart: SessionConsoleLessonPart;
};

export function usePendingRecordingDraft({ studentId, mode, lessonPart }: Params) {
  const [pendingDraft, setPendingDraft] = useState<PendingRecordingDraft | null>(null);
  const [pendingDraftPersistence, setPendingDraftPersistence] = useState<"durable" | "memory" | null>(null);

  const clearPendingDraftState = useCallback(async () => {
    const { clearPendingRecordingDraft } = await loadPendingRecordingStoreModule();
    await clearPendingRecordingDraft({ studentId, mode, lessonPart }).catch(() => {});
    setPendingDraft(null);
    setPendingDraftPersistence(null);
  }, [lessonPart, mode, studentId]);

  const savePendingDraftState = useCallback(
    async (file: File, durationSeconds: number | null) => {
      try {
        const { savePendingRecordingDraft } = await loadPendingRecordingStoreModule();
        const record = await savePendingRecordingDraft({
          studentId,
          mode,
          lessonPart,
          file,
          durationSeconds,
        });
        setPendingDraft(toPendingDraft(record));
        setPendingDraftPersistence("durable");
      } catch {
        setPendingDraft({
          key: `memory:${studentId}:${mode}:${lessonPart}`,
          file,
          createdAt: new Date().toISOString(),
          durationSeconds,
          sizeBytes: file.size,
        });
        setPendingDraftPersistence("memory");
      }
    },
    [lessonPart, mode, studentId]
  );

  const downloadPendingDraft = useCallback(() => {
    if (typeof window === "undefined" || !pendingDraft) return;
    const url = URL.createObjectURL(pendingDraft.file);
    const link = document.createElement("a");
    link.href = url;
    link.download = pendingDraft.file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [pendingDraft]);

  const loadPendingDraftState = useCallback(async () => {
    const { loadPendingRecordingDraft } = await loadPendingRecordingStoreModule();
    const record = await loadPendingRecordingDraft({ studentId, mode, lessonPart }).catch(() => null);
    setPendingDraft(record ? toPendingDraft(record) : null);
    setPendingDraftPersistence(record ? "durable" : null);
  }, [lessonPart, mode, studentId]);

  useEffect(() => {
    void loadPendingDraftState();
  }, [loadPendingDraftState]);

  return {
    clearPendingDraftState,
    downloadPendingDraft,
    loadPendingDraftState,
    pendingDraft,
    pendingDraftPersistence,
    savePendingDraftState,
    setPendingDraft,
    setPendingDraftPersistence,
  };
}
