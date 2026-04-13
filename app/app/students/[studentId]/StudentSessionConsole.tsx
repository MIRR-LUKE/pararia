"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { buildUnsupportedAudioUploadErrorMessage, isSupportedAudioUpload } from "@/lib/audio-upload-support";
import { buildLessonReportFlowMessage, getLessonReportPartState } from "@/lib/lesson-report-flow";
import { buildSessionPartUploadPathname } from "@/lib/audio-storage-paths";
import type { RecordingLockInfo, SessionItem } from "./roomTypes";
import {
  CLIENT_AUDIO_STORAGE_MODE,
  LIVE_CHUNK_UPLOAD_ENABLED,
  LIVE_STT_WINDOW_MS,
  MAX_SECONDS,
  MIN_SECONDS_BEFORE_SAVE_ENABLED,
  RECORDING_TIMESLICE_MS,
  buildChunkUploadFileName,
  buildUploadFileName,
  formatBytes,
  getDurationValidationMessage,
  loadBlobUploadModule,
  modeLabel,
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
import { StudentSessionConsoleLockSection } from "./StudentSessionConsoleLockSection";
import { StudentSessionConsoleProgressSection } from "./StudentSessionConsoleProgressSection";
import { StudentSessionConsoleRecordingSection } from "./StudentSessionConsoleRecordingSection";
import { StudentSessionConsoleUploadSection } from "./StudentSessionConsoleUploadSection";
import { usePendingRecordingDraft } from "./usePendingRecordingDraft";
import { useRecordingLock } from "./useRecordingLock";
import { useRecordingNavigationGuards } from "./useRecordingNavigationGuards";
import { useStudentSessionProgress } from "./useStudentSessionProgress";
import {
  buildStudentSessionConsoleProgress,
  buildStudentSessionConsoleStatusCopy,
} from "./studentSessionConsoleView";
import styles from "./studentSessionConsole.module.css";

export type { SessionConsoleLessonPart, SessionConsoleMode } from "./studentSessionConsoleTypes";

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

function StudentSessionConsoleInner({
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

  const lessonFlowState = getLessonReportPartState(ongoingLessonSession?.parts ?? []);
  const lessonFlowMessage = buildLessonReportFlowMessage(ongoingLessonSession);

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
    [handleSavedPartResponse, lessonPart, lockTokenRef, mode, queueLiveChunkUpload]
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
    async (
      file: File,
      uploadSource: UploadSource = "file_upload",
      durationSecondsHint: number | null = null
    ) => {
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
        const uploadPartType = mode === "INTERVIEW" ? "FULL" : lessonPart;
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
          });
          form.append("blobUrl", blob.url);
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
          const apiError = new Error(body?.error ?? "音声の保存に失敗しました。") as Error & {
            code?: string;
          };
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
      ensureLockForAudio,
      clearPendingDraftState,
      finalizeLock,
      handleSavedPartResponse,
      lessonPart,
      mode,
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
      // For stability we default to one finalized upload instead of chunked
      // in-flight transcription. This keeps Runpod and retry behavior simple.
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
        recorder = preferredMimeType
          ? new MediaRecorder(stream, { mimeType: preferredMimeType })
          : new MediaRecorder(stream);
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
          const totalBytes = chunksRef.current.reduce(
            (acc, part) => acc + (part instanceof Blob ? part.size : 0),
            0
          );
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
          const file = new File(
            [blob],
            buildUploadFileName(studentId, mode, lessonPart, activeMimeType),
            { type: activeMimeType }
          );
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
      setMessage(
        mode === "LESSON_REPORT" && lessonPart === "CHECK_IN"
          ? "録音を開始しました。終了すると音声を保存します。"
          : mode === "LESSON_REPORT" && lessonPart === "CHECK_OUT"
            ? "録音を開始しました。終了すると音声を保存し、チェックインと合算して自動生成します。"
            : "録音を開始しました。終了すると自動で保存して生成に入ります。"
      );
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
    [lockConflict, lockConflictName, mode, setCreatedConversationId, uploadAudioFile]
  );

  const retryPendingDraftUpload = useCallback(async () => {
    if (!pendingDraft) return;
    setError(null);
    setMessage("一時保存した録音を再送しています。");
    await uploadAudioFile(pendingDraft.file, "direct_recording", pendingDraft.durationSeconds);
  }, [pendingDraft, uploadAudioFile]);

  const discardPendingDraft = useCallback(async () => {
    setShowDiscardDraftDialog(false);
    await clearPendingDraftState();
    setError(null);
    setMessage("一時保存していた録音データを破棄しました。");
    if (state === "error") {
      setState("idle");
    }
  }, [clearPendingDraftState, state]);

  const canRecord =
    !lockConflict && !pendingDraft && state !== "preparing" && state !== "uploading" && state !== "processing";
  const canUpload =
    !lockConflict &&
    !pendingDraft &&
    state !== "preparing" &&
    state !== "recording" &&
    state !== "uploading" &&
    state !== "processing";
  const canStartFromCircle = canRecord && state !== "recording";
  const canFinishRecording = seconds >= MIN_SECONDS_BEFORE_SAVE_ENABLED;
  const pendingDraftCanUpload = pendingDraft
    ? pendingDraft.durationSeconds === null || !getDurationValidationMessage(mode, pendingDraft.durationSeconds)
    : false;
  const showPendingDraftWarning =
    Boolean(pendingDraft) &&
    (state === "idle" || state === "error");
  const visiblePendingDraft = showPendingDraftWarning ? pendingDraft : null;
  const remainingSecondsUntilSavable = Math.max(0, MIN_SECONDS_BEFORE_SAVE_ENABLED - seconds);
  const isPreparingOrRecording = state === "preparing" || state === "recording";
  const generationProgress = useMemo(
    () =>
      buildStudentSessionConsoleProgress({
        mode,
        state,
        sessionProgress,
      }),
    [mode, sessionProgress, state]
  );
  const showGenerationProgress =
    Boolean(generationProgress) &&
    !(mode === "LESSON_REPORT" && lessonPart === "CHECK_IN");
  const statusCopy = useMemo(
    () =>
      buildStudentSessionConsoleStatusCopy({
        mode,
        lessonPart,
        state,
        studentName,
        message,
        generationProgress,
      }),
    [generationProgress, lessonPart, mode, message, state, studentName]
  );

  return (
    <div className={styles.console} data-recording-state={state}>
      {showModePicker ? (
        <>
          <div className={styles.modePicker} role="tablist" aria-label="録音モード">
            <button
              type="button"
              className={`${styles.modeButton} ${mode === "INTERVIEW" ? styles.modeButtonActive : ""}`}
              onClick={() => onModeChange("INTERVIEW")}
              disabled={isPreparingOrRecording || Boolean(pendingDraft)}
            >
              面談
            </button>
            <button
              type="button"
              className={`${styles.modeButton} ${mode === "LESSON_REPORT" ? styles.modeButtonActive : ""}`}
              onClick={() => onModeChange("LESSON_REPORT")}
              disabled={isPreparingOrRecording || Boolean(pendingDraft)}
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
                  disabled={isPreparingOrRecording || Boolean(pendingDraft) || lessonFlowState.hasCheckIn}
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
                  disabled={isPreparingOrRecording || Boolean(pendingDraft) || !lessonFlowState.hasCheckIn}
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
        <StudentSessionConsoleRecordingSection
          state={state}
          currentModeLabel={isPreparingOrRecording ? modeLabel(mode, lessonPart) : null}
          currentStudentLabel={statusCopy.currentStudentLabel}
          statusLine={statusCopy.statusLine}
          lessonMetaLine={
            ongoingLessonSession?.id && mode === "LESSON_REPORT"
              ? lessonFlowState.hasCheckIn && !lessonFlowState.hasCheckOut
                ? lessonFlowState.hasReadyCheckIn
                  ? "チェックイン保存済み → チェックアウト待ち"
                  : "チェックイン受付済み → 裏で文字起こし中"
                : "同じ授業セッションに追記されます"
              : null
          }
          lessonGuide={mode === "LESSON_REPORT" ? lessonFlowMessage : null}
          canStartFromCircle={canStartFromCircle}
          isPaused={isPaused}
          levels={levels}
          seconds={seconds}
          estimatedSize={estimatedSize}
          canFinishRecording={canFinishRecording}
          remainingSecondsUntilSavable={remainingSecondsUntilSavable}
          onStartRecording={() => void startRecording()}
          onTogglePause={togglePause}
          onRequestCancelRecording={requestCancelRecording}
          onStopRecording={stopRecording}
        />

        <StudentSessionConsoleProgressSection
          showGenerationProgress={showGenerationProgress}
          progress={generationProgress}
        />

        <StudentSessionConsoleLockSection lockConflict={Boolean(lockConflict)} lockConflictName={lockConflictName} />

        <StudentSessionConsoleUploadSection
          canUpload={canUpload}
          pendingDraft={visiblePendingDraft}
          pendingDraftPersistence={pendingDraftPersistence}
          pendingDraftCanUpload={pendingDraftCanUpload}
          error={error}
          recoverableSessionId={recoverableSessionId}
          createdConversationId={createdConversationId}
          message={message}
          state={state}
          onSelectFile={(file) => void handleFileSelection(file)}
          onRetryPendingDraft={() => void retryPendingDraftUpload()}
          onDownloadPendingDraft={downloadPendingDraft}
          onDiscardPendingDraft={() => setShowDiscardDraftDialog(true)}
          onRetryGeneration={() => void retryGeneration()}
          onReset={reset}
          onOpenLog={onOpenLog}
        />
      </div>

      <ConfirmDialog
        open={showCancelDialog}
        title="録音を中止しますか？"
        description="ここまでの録音はこの端末に一時保存できます。あとで再送することも、端末へ保存してから破棄することもできます。"
        details={[
          "終了は保存して処理へ進みます。",
          "キャンセルはサーバーへ送らず、この端末に一時保存します。",
        ]}
        confirmLabel="録音を中止する"
        cancelLabel="続ける"
        tone="danger"
        onConfirm={confirmCancelRecording}
        onCancel={() => setShowCancelDialog(false)}
      />

      <ConfirmDialog
        open={showDiscardDraftDialog}
        title="一時保存した録音を破棄しますか？"
        description="破棄すると、この端末に残っている再送用の録音データも消えます。"
        confirmLabel="破棄する"
        cancelLabel="戻る"
        tone="danger"
        onConfirm={() => void discardPendingDraft()}
        onCancel={() => setShowDiscardDraftDialog(false)}
      />
    </div>
  );
}

StudentSessionConsoleInner.displayName = "StudentSessionConsole";

export const StudentSessionConsole = memo(StudentSessionConsoleInner);
