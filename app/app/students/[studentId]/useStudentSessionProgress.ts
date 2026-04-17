"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  ConsoleState,
  SessionConsoleLessonPart,
  SessionConsoleMode,
  SessionProgressResponse,
} from "./studentSessionConsoleTypes";
import type { SessionItem, SessionPipelineInfo } from "./roomTypes";
import { sleep } from "./studentSessionConsoleUtils";

type Params = {
  studentId: string;
  mode: SessionConsoleMode;
  lessonPart: SessionConsoleLessonPart;
  ongoingLessonSession?: SessionItem | null;
  onLessonPartChange: (part: SessionConsoleLessonPart) => void;
  onRefresh: () => Promise<void> | void;
  setState: (state: ConsoleState) => void;
  setError: (value: string | null) => void;
  setMessage: (value: string) => void;
};

function isPageHidden() {
  return typeof document !== "undefined" && document.visibilityState !== "visible";
}

export function getSessionProgressPollIntervalMs(elapsedMs: number, pageHidden: boolean) {
  if (pageHidden) {
    if (elapsedMs < 60_000) return 8_000;
    if (elapsedMs < 180_000) return 12_000;
    return 15_000;
  }

  if (elapsedMs < 30_000) return 1_500;
  if (elapsedMs < 120_000) return 2_500;
  if (elapsedMs < 300_000) return 3_500;
  return 5_000;
}

export function getSessionProgressWakeIntervalMs(elapsedMs: number, pageHidden: boolean) {
  if (pageHidden) {
    if (elapsedMs < 120_000) return 15_000;
    return 30_000;
  }

  if (elapsedMs < 45_000) return 8_000;
  if (elapsedMs < 180_000) return 15_000;
  return 25_000;
}

export function shouldKickSessionProgressWorker(input: {
  elapsedMs: number;
  pageHidden: boolean;
  lastKickAt: number;
  stage: SessionProgressResponse["progress"]["stage"] | null;
}) {
  const lastKickAgoMs = input.lastKickAt > 0 ? Date.now() - input.lastKickAt : Number.POSITIVE_INFINITY;
  if (lastKickAgoMs < getSessionProgressWakeIntervalMs(input.elapsedMs, input.pageHidden)) {
    return false;
  }

  if (!input.stage) {
    return true;
  }

  return input.stage === "RECEIVED" || input.stage === "TRANSCRIBING";
}

export function useStudentSessionProgress({
  studentId,
  mode,
  lessonPart,
  ongoingLessonSession,
  onLessonPartChange,
  onRefresh,
  setState,
  setError,
  setMessage,
}: Params) {
  const [sessionProgress, setSessionProgress] = useState<SessionPipelineInfo | null>(
    ongoingLessonSession?.pipeline ?? null
  );
  const [createdConversationId, setCreatedConversationId] = useState<string | null>(null);
  const [recoverableSessionId, setRecoverableSessionId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const nextProgress = mode === "LESSON_REPORT" ? ongoingLessonSession?.pipeline ?? null : null;
    const nextConversationId = mode === "LESSON_REPORT" ? ongoingLessonSession?.conversation?.id ?? null : null;

    queueMicrotask(() => {
      if (cancelled) return;
      setSessionProgress(nextProgress);
      if (nextConversationId) {
        setCreatedConversationId(nextConversationId);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [mode, ongoingLessonSession]);

  const createSession = useCallback(async () => {
    const payload = {
      studentId,
      type: mode,
      title:
        mode === "INTERVIEW"
          ? `${new Date().toLocaleDateString("ja-JP")} の面談`
          : `${new Date().toLocaleDateString("ja-JP")} の指導報告`,
    };

    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.session?.id) {
      throw new Error(body?.error ?? "セッションの作成に失敗しました。");
    }
    return body.session.id as string;
  }, [mode, studentId]);

  const resolveTargetSessionId = useCallback(async () => {
    if (mode === "LESSON_REPORT" && ongoingLessonSession?.id) {
      return ongoingLessonSession.id;
    }
    return createSession();
  }, [createSession, mode, ongoingLessonSession]);

  const pollSessionProgress = useCallback(
    async (sessionId: string) => {
      const startedAt = Date.now();
      let lastWorkerKickAt = 0;
      let latestStage: SessionProgressResponse["progress"]["stage"] | null = null;
      setState("processing");
      setRecoverableSessionId(sessionId);

      while (Date.now() - startedAt < 300000) {
        const now = Date.now();
        const elapsedMs = now - startedAt;
        const pageHidden = isPageHidden();
        const pollingIntervalMs = getSessionProgressPollIntervalMs(elapsedMs, pageHidden);
        if (
          shouldKickSessionProgressWorker({
            elapsedMs,
            pageHidden,
            lastKickAt: lastWorkerKickAt,
            stage: latestStage,
          })
        ) {
          lastWorkerKickAt = Date.now();
          void fetch(`/api/sessions/${sessionId}/progress`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          }).catch(() => {});
        }
        const res = await fetch(`/api/sessions/${sessionId}/progress`, {
          cache: "no-store",
        });
        const body = (await res.json().catch(() => ({}))) as SessionProgressResponse & { error?: string };
        if (!res.ok || !body?.progress) {
          await sleep(pollingIntervalMs);
          continue;
        }

        latestStage = body.progress.stage;
        setSessionProgress(body.progress);
        const openLogId = body.progress.openLogId ?? body.conversation?.id ?? null;
        if (openLogId) {
          setCreatedConversationId(openLogId);
        }

        if (body.progress.stage === "WAITING_COUNTERPART") {
          setRecoverableSessionId(null);
          setState("success");
          setError(null);
          setMessage(body.progress.progress.description);
          if (mode === "LESSON_REPORT") {
            onLessonPartChange(body.progress.waitingForPart === "CHECK_IN" ? "CHECK_IN" : "CHECK_OUT");
          }
          await onRefresh();
          return openLogId;
        }

        if (body.progress.stage === "READY") {
          setRecoverableSessionId(null);
          setState("success");
          setError(null);
          setMessage(body.progress.progress.description);
          await onRefresh();
          return openLogId;
        }

        if (body.progress.stage === "REJECTED" || body.progress.stage === "ERROR") {
          setState("error");
          setError(body.progress.progress.description);
          await onRefresh();
          return null;
        }

        await sleep(pollingIntervalMs);
      }

      setState("success");
      setMessage("処理を続けています。閉じても大丈夫です。ログや一覧から続きの反映を確認できます。");
      await onRefresh();
      return null;
    },
    [mode, onLessonPartChange, onRefresh, setError, setMessage, setState]
  );

  const handleSavedPartResponse = useCallback(
    async (body: any, sessionId: string) => {
      setSessionProgress(null);
      setRecoverableSessionId(sessionId);
      setError(null);
      if (mode === "LESSON_REPORT" && lessonPart === "CHECK_IN") {
        setRecoverableSessionId(null);
        setState("idle");
        setMessage("チェックインを保存しました。チェックアウトへ進んでください。文字起こしは裏で続けます。");
        onLessonPartChange("CHECK_OUT");
        await onRefresh();
        return null;
      }

      setState("processing");
      setMessage(
        mode === "INTERVIEW"
          ? "文字起こし準備中です。STT worker の起動が終わりしだい、文字起こしに入ります。"
          : "文字起こし準備中です。STT worker の起動が終わりしだい、指導報告ログの準備に入ります。"
      );
      await onRefresh();
      return pollSessionProgress(sessionId);
    },
    [lessonPart, mode, onLessonPartChange, onRefresh, pollSessionProgress, setError, setMessage, setState]
  );

  const retryGeneration = useCallback(async () => {
    const sessionId = recoverableSessionId;
    if (!sessionId) return;

    setError(null);
    setState("processing");

    try {
      await pollSessionProgress(sessionId);
    } catch (nextError: any) {
      setState("error");
      setError(nextError?.message ?? "生成の再開に失敗しました。");
    }
  }, [pollSessionProgress, recoverableSessionId, setError, setState]);

  const resetSessionProgress = useCallback(() => {
    setSessionProgress(mode === "LESSON_REPORT" ? ongoingLessonSession?.pipeline ?? null : null);
    setCreatedConversationId(null);
    setRecoverableSessionId(null);
  }, [mode, ongoingLessonSession?.pipeline]);

  return {
    createdConversationId,
    handleSavedPartResponse,
    pollSessionProgress,
    recoverableSessionId,
    resetSessionProgress,
    resolveTargetSessionId,
    retryGeneration,
    sessionProgress,
    setCreatedConversationId,
    setRecoverableSessionId,
    setSessionProgress,
  };
}
