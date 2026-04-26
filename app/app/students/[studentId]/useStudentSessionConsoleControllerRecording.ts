"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { buildUnsupportedAudioUploadErrorMessage, isSupportedAudioUpload } from "@/lib/audio-upload-support";
import { buildSessionPartUploadPathname } from "@/lib/audio-storage-paths";
import { buildRecordingAutoStopMessage } from "@/lib/recording/policy";
import type { RecordingLockInfo, SessionItem } from "./roomTypes";
import {
  CLIENT_AUDIO_STORAGE_MODE,
  LIVE_CHUNK_UPLOAD_ENABLED,
  LIVE_STT_WINDOW_MS,
  MAX_SECONDS,
  RECORDING_TIMESLICE_MS,
  buildChunkUploadFileName,
  buildUploadFileName,
  formatBytes,
  getDurationValidationMessage,
  loadBlobUploadModule,
  pickRecordingMimeType,
  readAudioDurationSeconds,
  stopTracks,
} from "./studentSessionConsoleUtils";
import type {
  ConsoleState,
  SessionConsoleLessonPart,
  SessionConsoleMode,
  StopIntent,
  UploadSource,
} from "./studentSessionConsoleTypes";
import { usePendingRecordingDraft } from "./usePendingRecordingDraft";
import { useRecordingLock } from "./useRecordingLock";
import { useRecordingNavigationGuards } from "./useRecordingNavigationGuards";
import { useStudentSessionProgress } from "./useStudentSessionProgress";
import { buildStudentSessionConsoleDerivedState } from "./studentSessionConsoleDerivedState";
import { useStudentSessionConsoleDraftActions } from "./useStudentSessionConsoleDraftActions";
export type StudentSessionConsoleControllerParams = {
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
  autoStartOnMount?: boolean;
};
type RecordingParams = StudentSessionConsoleControllerParams;
export function useStudentSessionConsoleRecording({
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
  autoStartOnMount = false,
}: RecordingParams) {
  const [state, setState] = useState<ConsoleState>("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [levels, setLevels] = useState([12, 18, 14, 24, 16, 20, 15]);
  const [estimatedSize, setEstimatedSize] = useState("0 B");
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showDiscardDraftDialog, setShowDiscardDraftDialog] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const livePendingChunksRef = useRef<Blob[]>([]);
  const livePendingDurationMsRef = useRef(0);
  const liveUploadedUntilMsRef = useRef(0);
  const liveChunkSequenceRef = useRef(0);
  const liveUploadQueueRef = useRef<Promise<void>>(Promise.resolve());
  const liveUploadErrorRef = useRef<Error | null>(null);
  const recordedDurationMsRef = useRef(0);
  const recordingSessionIdRef = useRef<string | null>(null);
  const liveStreamingEnabledRef = useRef(false);
  const mimeTypeRef = useRef("audio/webm");
  const autoStartedRef = useRef(false);
  const secondsRef = useRef(0);
  const stopIntentRef = useRef<StopIntent>("save");
  const activeRecordingStateRef = useRef<ConsoleState>("idle");
  useEffect(() => {
    secondsRef.current = seconds;
  }, [seconds]);
  useEffect(() => {
    activeRecordingStateRef.current = state;
  }, [state]);
  const {
    acquireLock,
    ensureLockForAudio,
    finalizeLock,
    lockConflict,
    lockConflictName,
    lockTokenRef,
  } = useRecordingLock({
    studentId,
    mode,
    recordingLock,
    isActive: state === "preparing" || state === "recording",
  });
  const {
    clearPendingDraftState,
    downloadPendingDraft,
    pendingDraft,
    pendingDraftPersistence,
    savePendingDraftState,
  } = usePendingRecordingDraft({
    studentId,
    mode,
    lessonPart,
  });
  const {
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
  } = useStudentSessionProgress({
    studentId,
    mode,
    lessonPart,
    ongoingLessonSession,
    onLessonPartChange,
    onRefresh,
    setState,
    setError,
    setMessage,
  });
  useRecordingNavigationGuards({
    enabled: state === "preparing" || state === "recording" || state === "uploading" || Boolean(pendingDraft),
    pendingDraft,
  });
  useEffect(() => {
    if (state !== "recording" || typeof document === "undefined") return undefined;
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      try {
        mediaRecorderRef.current?.requestData();
      } catch {
        // noop
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [state]);
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
    setMessage(buildRecordingAutoStopMessage(mode, MAX_SECONDS[mode]));
    try {
      mediaRecorderRef.current?.stop();
    } catch {
      setState("error");
      setError("録音の停止に失敗しました。もう一度お試しください。");
    }
  }, [mode, seconds, state]);
  useEffect(() => {
    return () => {
      const preserveActiveRecording =
        activeRecordingStateRef.current === "preparing" || activeRecordingStateRef.current === "recording";
      if (!preserveActiveRecording) {
        try {
          mediaRecorderRef.current?.stop();
        } catch {
          // noop
        }
        stopTracks(mediaStreamRef.current);
        void finalizeLock();
        resetLiveCapture();
      }
    };
  }, [finalizeLock, resetLiveCapture]);
  const queueLiveChunkUpload = useCallback(
    async (options?: { force?: boolean }) => {
      if (!liveStreamingEnabledRef.current) return;
      if (!recordingSessionIdRef.current || !lockTokenRef.current) return;
      if (!livePendingChunksRef.current.length) return;
      if (!options?.force && livePendingDurationMsRef.current < LIVE_STT_WINDOW_MS[mode]) return;
      const partType = "FULL";
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
      const chunkFile = new File(pendingChunks, buildChunkUploadFileName(baseName, sequence), { type: mimeType });
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
      }).catch((nextError) => {
        liveUploadErrorRef.current = nextError instanceof Error ? nextError : new Error(String(nextError));
        liveStreamingEnabledRef.current = false;
      });
      await liveUploadQueueRef.current;
    },
    [lessonPart, lockTokenRef, mode, studentId]
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
          partType: "FULL",
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
    [handleSavedPartResponse, lockTokenRef, queueLiveChunkUpload]
  );
  const reset = useCallback(() => {
    setState("idle");
    setMessage("");
    setError(null);
    setSeconds(0);
    setIsPaused(false);
    setEstimatedSize("0 B");
    recordedDurationMsRef.current = 0;
    resetSessionProgress();
    autoStartedRef.current = false;
    resetLiveCapture();
  }, [resetLiveCapture, resetSessionProgress]);
  const uploadAudioFile = useCallback(
    async (file: File, uploadSource: UploadSource = "file_upload", durationSecondsHint: number | null = null) => {
      let savedSessionId: string | null = null;
      let partSaved = false;
      setError(null);
      setMessage("音声を保存しています。");
      setState("uploading");
      setSessionProgress(null);
      setRecoverableSessionId(null);
      try {
        const token = await ensureLockForAudio();
        const sessionId = await resolveTargetSessionId();
        const uploadPartType = "FULL";
        savedSessionId = sessionId;
        const form = new FormData();
        form.append("partType", uploadPartType);
        form.append("lockToken", token);
        form.append("uploadSource", uploadSource);
        if (durationSecondsHint !== null && Number.isFinite(durationSecondsHint)) {
          form.append("durationSecondsHint", String(durationSecondsHint));
        }
        if (CLIENT_AUDIO_STORAGE_MODE === "blob") {
          setMessage("音声を共有保存へ送っています。");
          const { uploadFileToBlobFromBrowser } = await loadBlobUploadModule();
          const blob = await uploadFileToBlobFromBrowser({
            pathname: buildSessionPartUploadPathname(sessionId, uploadPartType, file.name),
            file,
            access: "private",
            handleUploadUrl: "/api/blob/upload",
            uploadSource,
          });
          form.append("blobUrl", blob.url);
          form.append("blobPathname", blob.pathname);
          form.append("fileName", file.name);
          form.append("blobContentType", blob.contentType || file.type);
          form.append("blobSize", String(file.size));
        } else {
          form.append("file", file);
        }
        const res = await fetch(`/api/sessions/${sessionId}/parts`, {
          method: "POST",
          body: form,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          const apiError = new Error(body?.error ?? "音声の保存に失敗しました。") as Error & { code?: string };
          apiError.code = typeof body?.code === "string" ? body.code : undefined;
          throw apiError;
        }
        partSaved = true;
        if (uploadSource === "direct_recording") {
          await clearPendingDraftState();
        }
        await handleSavedPartResponse(body, sessionId);
      } catch (nextError: any) {
        setState("error");
        if (partSaved) {
          setRecoverableSessionId(savedSessionId);
          setError(nextError?.message ?? "音声は保存済みですが、処理の開始に失敗しました。");
        } else {
          if (uploadSource === "direct_recording" && pendingDraft) {
            setError(
              `${nextError?.message ?? "音声の保存に失敗しました。"} 録音データはこの端末に一時保存したままです。再送するか、先にダウンロードしてください。`
            );
          } else {
            setError(nextError?.message ?? "音声の保存に失敗しました。");
          }
        }
      } finally {
        await finalizeLock();
      }
    },
    [
      clearPendingDraftState,
      ensureLockForAudio,
      finalizeLock,
      handleSavedPartResponse,
      pendingDraft,
      resolveTargetSessionId,
      setRecoverableSessionId,
      setSessionProgress,
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
    recordedDurationMsRef.current = 0;
    stopIntentRef.current = "save";
    if (lockConflict) {
      setState("error");
      setError(`${lockConflictName} が録音中です。終了後に開始してください。`);
      return;
    }
    if (pendingDraft) {
      setState("error");
      setError("未送信の録音データが残っています。先に再送するか、端末へ保存してから破棄してください。");
      return;
    }
    let cancelPendingStart = false;
    let pendingStartStream: MediaStream | null = null;
    try {
      if (typeof window === "undefined") return;
      if (!window.isSecureContext) {
        throw new Error("録音は HTTPS または localhost の環境でのみ利用できます。");
      }
      if (typeof MediaRecorder === "undefined") {
        throw new Error("このブラウザは録音に対応していません。");
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("このブラウザはマイク入力に対応していません。");
      }
      setState("preparing");
      setMessage("マイクと録音セッションを準備しています。許可が求められたら、このまま続けてください。");
      const streamPromise = navigator.mediaDevices
        .getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })
        .then((stream) => {
          pendingStartStream = stream;
          if (cancelPendingStart) {
            stopTracks(stream);
            throw new Error("録音の開始が中断されました。");
          }
          return stream;
        });
      const lockPromise = acquireLock();
      await lockPromise;
      liveStreamingEnabledRef.current = LIVE_CHUNK_UPLOAD_ENABLED;
      liveUploadErrorRef.current = null;
      liveUploadQueueRef.current = Promise.resolve();
      livePendingChunksRef.current = [];
      livePendingDurationMsRef.current = 0;
      liveUploadedUntilMsRef.current = 0;
      liveChunkSequenceRef.current = 0;
      if (liveStreamingEnabledRef.current) {
        const sessionId = await resolveTargetSessionId();
        recordingSessionIdRef.current = sessionId;
      } else {
        recordingSessionIdRef.current = null;
      }
      const preferredMimeType = pickRecordingMimeType();
      const stream = await streamPromise;
      pendingStartStream = null;
      mediaStreamRef.current = stream;
      chunksRef.current = [];
      let recorder: MediaRecorder;
      try {
        recorder = preferredMimeType
          ? new MediaRecorder(stream, {
              mimeType: preferredMimeType,
              audioBitsPerSecond: 64000,
            })
          : new MediaRecorder(stream, {
              audioBitsPerSecond: 64000,
            });
      } catch {
        recorder = preferredMimeType ? new MediaRecorder(stream, { mimeType: preferredMimeType }) : new MediaRecorder(stream);
      }
      mimeTypeRef.current = recorder.mimeType || preferredMimeType || "audio/webm";
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
          recordedDurationMsRef.current += RECORDING_TIMESLICE_MS;
          setSeconds(Math.max(1, Math.floor(recordedDurationMsRef.current / 1000)));
          if (event.data instanceof Blob && liveStreamingEnabledRef.current) {
            livePendingChunksRef.current.push(event.data);
            livePendingDurationMsRef.current += RECORDING_TIMESLICE_MS;
            void queueLiveChunkUpload();
          }
          const totalBytes = chunksRef.current.reduce((acc, part) => acc + (part instanceof Blob ? part.size : 0), 0);
          setEstimatedSize(formatBytes(totalBytes));
        }
      };
      recorder.onerror = () => {
        stopIntentRef.current = "cancel";
        setState("uploading");
        setError(null);
        setMessage("録音中に問題が発生したため、ここまでの音声を保全しています。");
        try {
          recorder.requestData();
        } catch {
          // noop
        }
        try {
          recorder.stop();
        } catch {
          setState("error");
          setError("録音中にエラーが発生し、音声の保全にも失敗しました。");
          void finalizeLock();
        }
      };
      recorder.onstop = async () => {
        const activeMimeType = mimeTypeRef.current;
        try {
          const blob = new Blob(chunksRef.current, { type: activeMimeType });
          const file = new File([blob], buildUploadFileName(studentId, mode, lessonPart, activeMimeType), {
            type: activeMimeType,
          });
          const parsedDurationSeconds = await readAudioDurationSeconds(file);
          const recordedDurationSeconds =
            recordedDurationMsRef.current > 0
              ? recordedDurationMsRef.current / 1000
              : secondsRef.current > 0
                ? secondsRef.current
                : null;
          const durationSeconds =
            parsedDurationSeconds !== null && recordedDurationSeconds !== null
              ? Math.max(parsedDurationSeconds, recordedDurationSeconds)
              : parsedDurationSeconds ?? recordedDurationSeconds;
          await savePendingDraftState(file, durationSeconds);
          if (stopIntentRef.current === "cancel") {
            setState("idle");
            setMessage("録音を中止しました。ここまでの音声はこの端末に一時保存しました。必要なら再送またはダウンロードできます。");
            setError(null);
            await finalizeLock();
            return;
          }
          const durationMessage = getDurationValidationMessage(mode, durationSeconds);
          if (durationMessage) {
            setState("error");
            setError(durationMessage);
            await finalizeLock();
            return;
          }
          const liveSessionId = recordingSessionIdRef.current;
          if (liveStreamingEnabledRef.current && liveSessionId) {
            try {
              await finalizeLiveRecording(liveSessionId);
            } catch {
              liveStreamingEnabledRef.current = false;
              await uploadAudioFile(file, "direct_recording", durationSeconds);
            }
          } else {
            await uploadAudioFile(file, "direct_recording", durationSeconds);
          }
        } catch (nextError: any) {
          setState("error");
          setError(nextError?.message ?? "録音データの保全または保存に失敗しました。");
          await finalizeLock();
        } finally {
          stopTracks(mediaStreamRef.current);
          mediaStreamRef.current = null;
          mediaRecorderRef.current = null;
          chunksRef.current = [];
          setSeconds(0);
          setIsPaused(false);
          recordedDurationMsRef.current = 0;
          resetLiveCapture();
        }
      };
      recorder.start(RECORDING_TIMESLICE_MS);
      setState("recording");
      setMessage("録音を開始しました。終了すると自動で保存して生成に入ります。");
    } catch (nextError: any) {
      cancelPendingStart = true;
      stopTracks(pendingStartStream);
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
    savePendingDraftState,
    lessonPart,
    lockConflict,
    lockConflictName,
    mode,
    pendingDraft,
    queueLiveChunkUpload,
    resolveTargetSessionId,
    resetLiveCapture,
    setCreatedConversationId,
    setSessionProgress,
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
      stopIntentRef.current = "save";
      mediaRecorderRef.current?.stop();
      setState("uploading");
      setMessage("録音を保存しています。");
    } catch {
      setState("error");
      setError("録音停止に失敗しました。");
    }
  }, []);
  const requestCancelRecording = useCallback(() => {
    setShowCancelDialog(true);
  }, []);
  const confirmCancelRecording = useCallback(() => {
    setShowCancelDialog(false);
    try {
      stopIntentRef.current = "cancel";
      mediaRecorderRef.current?.stop();
      setState("uploading");
      setMessage("録音を中止して保全しています。");
    } catch {
      setState("error");
      setError("録音のキャンセルに失敗しました。");
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
  const { discardPendingDraft, handleFileSelection, retryPendingDraftUpload } = useStudentSessionConsoleDraftActions({
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
  });

  const derivedState = buildStudentSessionConsoleDerivedState({
    lockConflict,
    pendingDraft,
    state,
    seconds,
    mode,
    lessonPart,
    sessionProgress,
    studentName,
    message,
  });

  return {
    canFinishRecording: derivedState.canFinishRecording, canRecord: derivedState.canRecord,
    canStartFromCircle: derivedState.canStartFromCircle, canUpload: derivedState.canUpload,
    confirmCancelRecording, createdConversationId, discardPendingDraft, downloadPendingDraft,
    error, estimatedSize, generationProgress: derivedState.generationProgress, handleFileSelection,
    isPaused, isPreparingOrRecording: derivedState.isPreparingOrRecording, levels, lockConflict,
    lockConflictName, message, mode, modeLabel: derivedState.modeLabel, onLessonPartChange,
    onModeChange, openCancelDialog: requestCancelRecording, pendingDraft: derivedState.pendingDraft,
    pendingDraftCanUpload: derivedState.pendingDraftCanUpload, pendingDraftPersistence,
    recoverableSessionId, remainingSecondsUntilSavable: derivedState.remainingSecondsUntilSavable,
    reset, retryGeneration, retryPendingDraftUpload, seconds, sessionProgress, setShowCancelDialog,
    setShowDiscardDraftDialog, showCancelDialog, showDiscardDraftDialog,
    showGenerationProgress: derivedState.showGenerationProgress, state, statusCopy: derivedState.statusCopy,
    startRecording, stopRecording, togglePause,
  };
}
