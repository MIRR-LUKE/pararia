"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { GenerationProgress } from "@/components/ui/GenerationProgress";
import { buildLessonReportFlowMessage, getLessonReportPartState } from "@/lib/lesson-report-flow";
import { RECORDING_LOCK_HEARTBEAT_MS } from "@/lib/recording/lockConstants";
import type { RecordingLockInfo, SessionItem, SessionPipelineInfo } from "./roomTypes";
import styles from "./studentSessionConsole.module.css";

export type SessionConsoleMode = "INTERVIEW" | "LESSON_REPORT";
export type SessionConsoleLessonPart = "CHECK_IN" | "CHECK_OUT";

type ConsoleState = "idle" | "recording" | "uploading" | "processing" | "success" | "error";

type SessionProgressResponse = {
  conversation?: {
    id: string;
    status: string;
  } | null;
  progress: SessionPipelineInfo;
};

type Props = {
  studentId: string;
  studentName: string;
  mode: SessionConsoleMode;
  lessonPart: SessionConsoleLessonPart;
  ongoingLessonSession?: SessionItem | null;
  onModeChange: (mode: SessionConsoleMode) => void;
  onLessonPartChange: (part: SessionConsoleLessonPart) => void;
  onRefresh: () => Promise<void> | void;
  onOpenLog: (logId: string) => void;
  recordingLock?: RecordingLockInfo;
  showModePicker?: boolean;
  autoStartOnMount?: boolean;
};

const MAX_SECONDS: Record<SessionConsoleMode, number> = {
  INTERVIEW: 60 * 60,
  LESSON_REPORT: 10 * 60,
};
const RECORDING_TIMESLICE_MS = 1000;
const LIVE_STT_WINDOW_MS: Record<SessionConsoleMode, number> = {
  INTERVIEW: 15_000,
  LESSON_REPORT: 8_000,
};

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatTime(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }

  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readAudioDurationSeconds(file: File) {
  return new Promise<number | null>((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    const cleanup = () => {
      URL.revokeObjectURL(url);
      audio.src = "";
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : null;
      cleanup();
      resolve(duration);
    };
    audio.onerror = () => {
      cleanup();
      resolve(null);
    };
    audio.src = url;
  });
}

function modeLabel(mode: SessionConsoleMode, part: SessionConsoleLessonPart) {
  if (mode === "INTERVIEW") return "面談";
  return part === "CHECK_OUT" ? "チェックアウト" : "チェックイン";
}

function buildUploadFileName(
  studentId: string,
  mode: SessionConsoleMode,
  part: SessionConsoleLessonPart,
  mimeType: string
) {
  const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("wav") ? "wav" : "webm";
  const prefix =
    mode === "INTERVIEW" ? "interview" : part === "CHECK_OUT" ? "lesson-checkout" : "lesson-checkin";
  return `${prefix}-${studentId}-${new Date().toISOString().slice(0, 19)}.${ext}`;
}

function buildChunkUploadFileName(baseName: string, sequence: number) {
  const dotIndex = baseName.lastIndexOf(".");
  if (dotIndex === -1) return `${baseName}-chunk-${String(sequence).padStart(4, "0")}`;
  return `${baseName.slice(0, dotIndex)}-chunk-${String(sequence).padStart(4, "0")}${baseName.slice(dotIndex)}`;
}

export function StudentSessionConsole({
  studentId,
  studentName,
  mode,
  lessonPart,
  ongoingLessonSession,
  onModeChange,
  onLessonPartChange,
  onRefresh,
  onOpenLog,
  recordingLock,
  showModePicker = true,
  autoStartOnMount = false,
}: Props) {
  const [state, setState] = useState<ConsoleState>("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [levels, setLevels] = useState([12, 18, 14, 24, 16, 20, 15]);
  const [estimatedSize, setEstimatedSize] = useState("0 B");
  const [createdConversationId, setCreatedConversationId] = useState<string | null>(null);
  const [sessionProgress, setSessionProgress] = useState<SessionPipelineInfo | null>(ongoingLessonSession?.pipeline ?? null);
  const [recoverableSessionId, setRecoverableSessionId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const livePendingChunksRef = useRef<Blob[]>([]);
  const livePendingDurationMsRef = useRef(0);
  const liveUploadedUntilMsRef = useRef(0);
  const liveChunkSequenceRef = useRef(0);
  const liveUploadQueueRef = useRef<Promise<void>>(Promise.resolve());
  const liveUploadErrorRef = useRef<Error | null>(null);
  const recordingSessionIdRef = useRef<string | null>(null);
  const liveStreamingEnabledRef = useRef(false);
  const mimeTypeRef = useRef("audio/webm");
  const lockTokenRef = useRef<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStartedRef = useRef(false);

  const lessonFlowState = getLessonReportPartState(ongoingLessonSession?.parts ?? []);
  const lessonFlowMessage = buildLessonReportFlowMessage(ongoingLessonSession);

  useEffect(() => {
    if (mode === "LESSON_REPORT") {
      setSessionProgress(ongoingLessonSession?.pipeline ?? null);
      if (ongoingLessonSession?.conversation?.id) {
        setCreatedConversationId(ongoingLessonSession.conversation.id);
      }
      return;
    }
    setSessionProgress(null);
  }, [mode, ongoingLessonSession?.conversation?.id, ongoingLessonSession?.pipeline]);

  const lockConflict =
    recordingLock?.active &&
    recordingLock.lock &&
    !recordingLock.lock.isHeldByViewer;

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const resetLiveCapture = useCallback(() => {
    livePendingChunksRef.current = [];
    livePendingDurationMsRef.current = 0;
    liveUploadedUntilMsRef.current = 0;
    liveChunkSequenceRef.current = 0;
    liveUploadQueueRef.current = Promise.resolve();
    liveUploadErrorRef.current = null;
    recordingSessionIdRef.current = null;
    liveStreamingEnabledRef.current = false;
  }, []);

  const releaseLockClient = useCallback(
    async (token: string) => {
      await fetch(`/api/students/${studentId}/recording-lock`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lockToken: token }),
      }).catch(() => {});
    },
    [studentId]
  );

  const acquireLock = useCallback(async () => {
    const res = await fetch(`/api/students/${studentId}/recording-lock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body?.error ?? "録音ロックの取得に失敗しました。");
    }
    const token = body.lockToken as string;
    lockTokenRef.current = token;
    heartbeatRef.current = setInterval(() => {
      void fetch(`/api/students/${studentId}/recording-lock`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lockToken: token }),
      });
    }, RECORDING_LOCK_HEARTBEAT_MS);
    return token;
  }, [mode, studentId]);

  const ensureLockForAudio = useCallback(async () => {
    if (lockTokenRef.current) return lockTokenRef.current;
    return acquireLock();
  }, [acquireLock]);

  useEffect(() => {
    if (state !== "recording" || isPaused) return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [isPaused, state]);

  useEffect(() => {
    if (state !== "recording" || isPaused) return;
    const timer = setInterval(() => {
      setLevels((current) => current.map(() => Math.max(6, Math.min(28, Math.random() * 30))));
    }, 180);
    return () => clearInterval(timer);
  }, [isPaused, state]);

  useEffect(() => {
    if (state !== "recording") return;
    if (seconds < MAX_SECONDS[mode]) return;
    setMessage(
      `${mode === "INTERVIEW" ? "60分" : "10分"}に達したため、自動で録音を停止して保存します。`
    );
    try {
      mediaRecorderRef.current?.stop();
    } catch {
      setState("error");
      setError("録音の停止に失敗しました。もう一度お試しください。");
    }
  }, [mode, seconds, state]);

  useEffect(() => {
    return () => {
      try {
        mediaRecorderRef.current?.stop();
      } catch {
        // noop
      }
      stopTracks(mediaStreamRef.current);
      stopHeartbeat();
      const token = lockTokenRef.current;
      lockTokenRef.current = null;
      if (token) void releaseLockClient(token);
      resetLiveCapture();
    };
  }, [releaseLockClient, resetLiveCapture, stopHeartbeat]);

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
  }, [createSession, mode, ongoingLessonSession?.id]);

  const pollSessionProgress = useCallback(
    async (sessionId: string) => {
      const startedAt = Date.now();
      let lastWorkerKickAt = 0;
      setState("processing");
      setRecoverableSessionId(sessionId);

      while (Date.now() - startedAt < 300000) {
        const now = Date.now();
        const shouldKickWorker = now - lastWorkerKickAt >= 2500;
        if (shouldKickWorker) {
          lastWorkerKickAt = now;
        }
        const res = await fetch(`/api/sessions/${sessionId}/progress${shouldKickWorker ? "?process=1" : ""}`, {
          cache: "no-store",
        });
        const body = (await res.json().catch(() => ({}))) as SessionProgressResponse & { error?: string };
        if (!res.ok || !body?.progress) {
          await sleep(800);
          continue;
        }

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

        await sleep(900);
      }

      setState("success");
      setMessage("処理を続けています。閉じても大丈夫です。ログや一覧から続きの反映を確認できます。");
      await onRefresh();
      return null;
    },
    [mode, onLessonPartChange, onRefresh]
  );

  const handleSavedPartResponse = useCallback(
    async (body: any, sessionId: string) => {
      setSessionProgress(null);
      setRecoverableSessionId(sessionId);
      setError(null);
      setState("processing");
      setMessage(
        mode === "INTERVIEW"
          ? "保存受付が完了しました。文字起こしと面談ログ生成を進めています。"
          : lessonPart === "CHECK_IN"
            ? "チェックインの保存受付が完了しました。まずは文字起こしを進めています。"
            : "チェックアウトの保存受付が完了しました。文字起こし後に指導報告ログへ進みます。"
      );
      if (mode === "LESSON_REPORT" && lessonPart === "CHECK_IN") {
        onLessonPartChange("CHECK_OUT");
      }
      await onRefresh();
      return pollSessionProgress(sessionId);
    },
    [lessonPart, mode, onLessonPartChange, onRefresh, pollSessionProgress]
  );

  const queueLiveChunkUpload = useCallback(
    async (options?: { force?: boolean }) => {
      if (!liveStreamingEnabledRef.current) return;
      if (!recordingSessionIdRef.current || !lockTokenRef.current) return;
      if (!livePendingChunksRef.current.length) return;
      if (!options?.force && livePendingDurationMsRef.current < LIVE_STT_WINDOW_MS[mode]) return;

      const partType = mode === "INTERVIEW" ? "FULL" : lessonPart;
      const sessionId = recordingSessionIdRef.current;
      const lockToken = lockTokenRef.current;
      const pendingChunks = livePendingChunksRef.current;
      const durationMs = livePendingDurationMsRef.current;
      const startedAtMs = liveUploadedUntilMsRef.current;
      const sequence = liveChunkSequenceRef.current;
      const mimeType = mimeTypeRef.current;

      livePendingChunksRef.current = [];
      livePendingDurationMsRef.current = 0;
      liveChunkSequenceRef.current += 1;

      const baseName = buildUploadFileName(studentId, mode, lessonPart, mimeType);
      const chunkFile = new File(
        pendingChunks,
        buildChunkUploadFileName(baseName, sequence),
        { type: mimeType }
      );

      liveUploadQueueRef.current = liveUploadQueueRef.current.then(async () => {
        const form = new FormData();
        form.append("partType", partType);
        form.append("sequence", String(sequence));
        form.append("startedAtMs", String(startedAtMs));
        form.append("durationMs", String(durationMs));
        form.append("file", chunkFile);
        form.append("lockToken", lockToken);

        const res = await fetch(`/api/sessions/${sessionId}/parts/live`, {
          method: "POST",
          body: form,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body?.error ?? "先行文字起こしの保存に失敗しました。");
        }
        liveUploadedUntilMsRef.current = startedAtMs + durationMs;
      }).catch((error) => {
        liveUploadErrorRef.current = error instanceof Error ? error : new Error(String(error));
        liveStreamingEnabledRef.current = false;
      });

      await liveUploadQueueRef.current;
    },
    [lessonPart, mode, studentId]
  );

  const finalizeLiveRecording = useCallback(
    async (sessionId: string) => {
      await queueLiveChunkUpload({ force: true });
      await liveUploadQueueRef.current;
      if (liveUploadErrorRef.current) {
        throw liveUploadErrorRef.current;
      }

      const res = await fetch(`/api/sessions/${sessionId}/parts/live`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partType: mode === "INTERVIEW" ? "FULL" : lessonPart,
          lockToken: lockTokenRef.current,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error ?? "録音の保存に失敗しました。");
      }

      await handleSavedPartResponse(body, sessionId);
      return body;
    },
    [handleSavedPartResponse, lessonPart, mode, queueLiveChunkUpload]
  );

  const reset = useCallback(() => {
    setState("idle");
    setMessage("");
    setError(null);
    setSeconds(0);
    setIsPaused(false);
    setEstimatedSize("0 B");
    setCreatedConversationId(null);
    setSessionProgress(mode === "LESSON_REPORT" ? ongoingLessonSession?.pipeline ?? null : null);
    setRecoverableSessionId(null);
    autoStartedRef.current = false;
    resetLiveCapture();
  }, [mode, ongoingLessonSession?.pipeline, resetLiveCapture]);

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
  }, [pollSessionProgress, recoverableSessionId]);

  const finalizeLock = useCallback(async () => {
    stopHeartbeat();
    const token = lockTokenRef.current;
    lockTokenRef.current = null;
    if (token) {
      await releaseLockClient(token);
    }
  }, [releaseLockClient, stopHeartbeat]);

  const uploadAudioFile = useCallback(
    async (file: File) => {
      let savedSessionId: string | null = null;
      let partSaved = false;

      setError(null);
      setMessage(
        mode === "LESSON_REPORT" && lessonPart === "CHECK_IN"
          ? "チェックインを保存しています。"
          : "音声を保存しています。"
      );
      setState("uploading");
      setSessionProgress(null);
      setRecoverableSessionId(null);

      try {
        const token = await ensureLockForAudio();
        const sessionId = await resolveTargetSessionId();
        savedSessionId = sessionId;
        const form = new FormData();
        form.append("partType", mode === "INTERVIEW" ? "FULL" : lessonPart);
        form.append("file", file);
        form.append("lockToken", token);

        const res = await fetch(`/api/sessions/${sessionId}/parts`, {
          method: "POST",
          body: form,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body?.error ?? "音声の保存に失敗しました。");
        }
        partSaved = true;
        await handleSavedPartResponse(body, sessionId);
      } catch (nextError: any) {
        setState("error");
        if (partSaved) {
          setRecoverableSessionId(savedSessionId);
          setError(nextError?.message ?? "音声は保存済みですが、処理の開始に失敗しました。");
        } else {
          setError(nextError?.message ?? "録音の保存に失敗しました。");
        }
      } finally {
        await finalizeLock();
      }
    },
    [
      ensureLockForAudio,
      finalizeLock,
      handleSavedPartResponse,
      lessonPart,
      mode,
      resolveTargetSessionId,
    ]
  );

  const startRecording = useCallback(async () => {
    setError(null);
    setMessage("");
    setCreatedConversationId(null);
    setSessionProgress(null);
    setSeconds(0);
    setEstimatedSize("0 B");
    setIsPaused(false);

    if (lockConflict) {
      setState("error");
      setError(`${recordingLock?.lock?.lockedByName ?? "他のユーザー"} が録音中です。終了後に開始してください。`);
      return;
    }

    try {
      if (typeof window === "undefined") return;
      if (!window.isSecureContext) {
        throw new Error("録音は HTTPS または localhost の環境でのみ利用できます。");
      }
      if (typeof MediaRecorder === "undefined") {
        throw new Error("このブラウザは録音に対応していません。");
      }

      await acquireLock();
      const sessionId = await resolveTargetSessionId();
      recordingSessionIdRef.current = sessionId;
      liveStreamingEnabledRef.current = true;
      liveUploadErrorRef.current = null;
      liveUploadQueueRef.current = Promise.resolve();
      livePendingChunksRef.current = [];
      livePendingDurationMsRef.current = 0;
      liveUploadedUntilMsRef.current = 0;
      liveChunkSequenceRef.current = 0;

      const mimeCandidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
      const mimeType = mimeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (!mimeType) {
        throw new Error("このブラウザでは録音形式を選べませんでした。");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;
      chunksRef.current = [];
      mimeTypeRef.current = mimeType;

      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 64000,
      });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
          if (event.data instanceof Blob && liveStreamingEnabledRef.current) {
            livePendingChunksRef.current.push(event.data);
            livePendingDurationMsRef.current += RECORDING_TIMESLICE_MS;
            void queueLiveChunkUpload();
          }
          const totalBytes = chunksRef.current.reduce(
            (acc, part) => acc + (part instanceof Blob ? part.size : 0),
            0
          );
          setEstimatedSize(formatBytes(totalBytes));
        }
      };

      recorder.onerror = () => {
        setState("error");
        setError("録音中にエラーが発生しました。");
      };

      recorder.onstop = async () => {
        const activeMimeType = mimeTypeRef.current;
        try {
          const blob = new Blob(chunksRef.current, { type: activeMimeType });
          const file = new File(
            [blob],
            buildUploadFileName(studentId, mode, lessonPart, activeMimeType),
            { type: activeMimeType }
          );
          const liveSessionId = recordingSessionIdRef.current;
          if (liveStreamingEnabledRef.current && liveSessionId) {
            try {
              await finalizeLiveRecording(liveSessionId);
            } catch {
              liveStreamingEnabledRef.current = false;
              await uploadAudioFile(file);
            }
          } else {
            await uploadAudioFile(file);
          }
        } finally {
          stopTracks(mediaStreamRef.current);
          mediaStreamRef.current = null;
          mediaRecorderRef.current = null;
          chunksRef.current = [];
          setSeconds(0);
          setIsPaused(false);
          resetLiveCapture();
        }
      };

      recorder.start(RECORDING_TIMESLICE_MS);
      setState("recording");
      setMessage(
        mode === "LESSON_REPORT" && lessonPart === "CHECK_IN"
          ? "録音を開始しました。終了すると音声を保存します。"
          : mode === "LESSON_REPORT" && lessonPart === "CHECK_OUT"
            ? "録音を開始しました。終了すると音声を保存し、チェックインと合算して自動生成します。"
            : "録音を開始しました。終了すると自動で保存して生成に入ります。"
      );
    } catch (nextError: any) {
      setState("error");
      setError(nextError?.message ?? "録音の開始に失敗しました。");
      stopTracks(mediaStreamRef.current);
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;
      chunksRef.current = [];
      await finalizeLock();
    }
  }, [
    acquireLock,
    finalizeLock,
    lessonPart,
    lockConflict,
    mode,
    queueLiveChunkUpload,
    recordingLock?.lock?.lockedByName,
    resolveTargetSessionId,
    resetLiveCapture,
    studentId,
    finalizeLiveRecording,
    uploadAudioFile,
  ]);

  useEffect(() => {
    if (!autoStartOnMount || autoStartedRef.current) return;
    if (state !== "idle") return;
    autoStartedRef.current = true;
    void startRecording();
  }, [autoStartOnMount, startRecording, state]);

  const stopRecording = useCallback(() => {
    try {
      mediaRecorderRef.current?.stop();
      setState("uploading");
      setMessage("録音を保存しています。");
    } catch {
      setState("error");
      setError("録音停止に失敗しました。");
    }
  }, []);

  const togglePause = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (recorder.state === "recording") {
      recorder.pause();
      setIsPaused(true);
      setMessage("一時停止中です。");
      return;
    }
    if (recorder.state === "paused") {
      recorder.resume();
      setIsPaused(false);
      setMessage("録音を再開しました。");
    }
  }, []);

  const handleFileSelection = useCallback(
    async (file: File | null) => {
      if (!file) return;
      if (!file.type.startsWith("audio/") && !file.name.match(/\.(webm|ogg|mp3|wav|m4a)$/i)) {
        setState("error");
        setError("音声ファイルを選択してください。");
        return;
      }
      if (lockConflict) {
        setState("error");
        setError(`${recordingLock?.lock?.lockedByName ?? "他のユーザー"} が録音中です。終了後に開始してください。`);
        return;
      }
      const durationSeconds = await readAudioDurationSeconds(file);
      if (durationSeconds !== null && durationSeconds > MAX_SECONDS[mode]) {
        setState("error");
        setError(
          mode === "LESSON_REPORT"
            ? "指導報告のチェックイン / チェックアウト音声は1回10分までです。10分以内に分割してください。"
            : "面談音声は1回60分までです。60分以内に分割してください。"
        );
        return;
      }
      setCreatedConversationId(null);
      await uploadAudioFile(file);
    },
    [lockConflict, mode, recordingLock?.lock?.lockedByName, uploadAudioFile]
  );

  const canRecord = !lockConflict && state !== "uploading" && state !== "processing";
  const canUpload = canRecord && state !== "recording";
  const canStartFromCircle = canRecord && state !== "recording";
  const generationProgress =
    state === "uploading" || state === "processing"
      ? sessionProgress?.progress ?? {
          title: "保存受付が完了しました",
          description: "処理を開始しています。このまま閉じても大丈夫です。",
          value: 18,
          steps:
            mode === "LESSON_REPORT"
              ? [
                  { id: "0-checkin", label: "チェックイン", status: "active" as const },
                  { id: "1-checkout", label: "チェックアウト", status: "pending" as const },
                  { id: "2-generate", label: "ログ生成", status: "pending" as const },
                  { id: "3-done", label: "完了", status: "pending" as const },
                ]
              : [
                  { id: "0-save", label: "保存受付", status: "complete" as const },
                  { id: "1-stt", label: "文字起こし", status: "active" as const },
                  { id: "2-generate", label: "ログ生成", status: "pending" as const },
                  { id: "3-done", label: "完了", status: "pending" as const },
                ],
        }
      : null;

  const idleHeadline =
    mode === "INTERVIEW"
      ? "面談を始めましょう"
      : lessonPart === "CHECK_OUT"
        ? "チェックアウト録音"
        : "チェックイン録音";

  const idleDescription =
    mode === "INTERVIEW"
      ? "録音が終わると、自動でログを整理して次回の話題まで更新します。"
      : lessonPart === "CHECK_OUT"
        ? "録音を保存すると、チェックインと合算して指導報告を自動生成します。"
        : "授業前の状態を短く録音して保存します（この段階では生成しません）。";

  return (
    <div className={styles.console}>
      {showModePicker ? (
        <>
          <div className={styles.modePicker} role="tablist" aria-label="録音モード">
            <button
              type="button"
              className={`${styles.modeButton} ${mode === "INTERVIEW" ? styles.modeButtonActive : ""}`}
              onClick={() => onModeChange("INTERVIEW")}
              disabled={state === "recording"}
            >
              面談
            </button>
            <button
              type="button"
              className={`${styles.modeButton} ${mode === "LESSON_REPORT" ? styles.modeButtonActive : ""}`}
              onClick={() => onModeChange("LESSON_REPORT")}
              disabled={state === "recording"}
            >
              指導報告
            </button>
          </div>

          {mode === "LESSON_REPORT" ? (
            <div className={styles.lessonSteps} role="tablist" aria-label="指導報告のステップ">
              <button
                type="button"
                className={`${styles.lessonStep} ${
                  lessonFlowState.hasCheckIn
                    ? styles.lessonStepDone
                    : lessonPart === "CHECK_IN"
                      ? styles.lessonStepCurrent
                      : styles.lessonStepPending
                }`}
                onClick={() => onLessonPartChange("CHECK_IN")}
                disabled={state === "recording" || lessonFlowState.hasCheckIn}
              >
                <span className={styles.lessonStepNum}>
                  {lessonFlowState.hasReadyCheckIn ? "✓" : lessonFlowState.hasCheckIn ? "…" : "1"}
                </span>
                <span>チェックイン</span>
              </button>
              <div className={`${styles.lessonStepConnector} ${lessonFlowState.hasCheckIn ? styles.lessonStepConnectorDone : ""}`} />
              <button
                type="button"
                className={`${styles.lessonStep} ${
                  lessonFlowState.hasCheckOut
                    ? styles.lessonStepDone
                    : lessonPart === "CHECK_OUT"
                      ? styles.lessonStepCurrent
                      : !lessonFlowState.hasCheckIn
                        ? styles.lessonStepLocked
                        : styles.lessonStepPending
                }`}
                onClick={() => onLessonPartChange("CHECK_OUT")}
                disabled={state === "recording" || !lessonFlowState.hasCheckIn}
              >
                <span className={styles.lessonStepNum}>
                  {lessonFlowState.hasReadyCheckOut ? "✓" : lessonFlowState.hasCheckOut ? "…" : !lessonFlowState.hasCheckIn ? "🔒" : "2"}
                </span>
                <span>チェックアウト</span>
              </button>
              <div className={`${styles.lessonStepConnector} ${lessonFlowState.isComplete ? styles.lessonStepConnectorDone : ""}`} />
              <div
                className={`${styles.lessonStep} ${
                  lessonFlowState.isComplete
                    ? styles.lessonStepCurrent
                    : styles.lessonStepPending
                }`}
              >
                <span className={styles.lessonStepNum}>3</span>
                <span>自動生成</span>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      <div className={styles.surface}>
        <div className={styles.recorderArea}>
          <button
            type="button"
            className={`${styles.microphoneCircle} ${canStartFromCircle ? styles.microphoneButton : styles.microphoneButtonDisabled}`}
            onClick={() => void startRecording()}
            disabled={!canStartFromCircle}
            aria-label="録音を開始する"
          >
            <span className={styles.microphoneGlyph} aria-hidden />
          </button>

          <div className={styles.recorderMeta}>
            {state === "recording" ? <div className={styles.currentMode}>{modeLabel(mode, lessonPart)}</div> : null}
            <div className={styles.currentStudent}>
              {state === "recording" ? `${studentName} を録音中` : idleHeadline}
            </div>
            <div className={styles.statusLine}>
              {state === "recording"
                ? mode === "LESSON_REPORT" && lessonPart === "CHECK_IN"
                  ? "話し終えたら終了してください。音声を保存します。"
                  : "話し終えたら終了してください。自動で保存して生成に入ります。"
                : state === "uploading" || state === "processing"
                  ? generationProgress?.description ?? message
                  : message || idleDescription}
            </div>
            {ongoingLessonSession?.id && mode === "LESSON_REPORT" ? (
              <div className={styles.lessonMeta}>
                {lessonFlowState.hasCheckIn && !lessonFlowState.hasCheckOut
                  ? lessonFlowState.hasReadyCheckIn
                    ? "チェックイン保存済み → チェックアウト待ち"
                    : "チェックイン受付済み → 裏で文字起こし中"
                  : "同じ授業セッションに追記されます"}
              </div>
            ) : null}
          </div>

          {mode === "LESSON_REPORT" ? (
            <div className={styles.lessonGuide}>
              <p>{lessonFlowMessage}</p>
            </div>
          ) : null}

          {state === "recording" ? (
            <>
              <div className={styles.timer}>{formatTime(seconds)}</div>
              <div className={styles.wave}>
                {levels.map((height, index) => (
                  <span key={`${index}-${height}`} className={styles.waveBar} style={{ height: `${height}px` }} />
                ))}
              </div>
              <div className={styles.inlineActions}>
                <Button variant="secondary" onClick={togglePause}>
                  {isPaused ? "再開" : "一時停止"}
                </Button>
                <Button onClick={stopRecording}>終了</Button>
              </div>
              <div className={styles.supportLine}>現在のサイズ: {estimatedSize}</div>
            </>
          ) : (
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
                accept="audio/*"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  event.currentTarget.value = "";
                  void handleFileSelection(file);
                }}
              />
            </>
          )}

          {state === "processing" || state === "uploading" ? (
            generationProgress ? <GenerationProgress progress={generationProgress} /> : null
          ) : null}

          {lockConflict ? (
            <div className={styles.warningBox}>
              <strong>他の担当者が録音中です</strong>
              <p>
                {recordingLock?.lock?.lockedByName ?? "他のユーザー"} がこの生徒で録音中です。終了後に開始してください。
              </p>
            </div>
          ) : null}

          {error ? (
            <div className={styles.errorBox}>
              <strong>処理に失敗しました</strong>
              <p>{error}</p>
              {recoverableSessionId ? (
                <div className={styles.inlineActions}>
                  <Button onClick={() => void retryGeneration()}>生成を再開する</Button>
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
                <Button variant="secondary" onClick={reset}>
                  もう一度録る
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
