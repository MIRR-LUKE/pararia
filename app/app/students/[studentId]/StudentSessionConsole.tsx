"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { GenerationProgress } from "@/components/ui/GenerationProgress";
import { buildConversationGenerationProgress } from "@/lib/generation-progress";
import { buildLessonReportFlowMessage, getLessonReportPartState } from "@/lib/lesson-report-flow";
import { RECORDING_LOCK_HEARTBEAT_MS } from "@/lib/recording/lockConstants";
import type { RecordingLockInfo, SessionItem } from "./roomTypes";
import styles from "./studentSessionConsole.module.css";

export type SessionConsoleMode = "INTERVIEW" | "LESSON_REPORT";
export type SessionConsoleLessonPart = "CHECK_IN" | "CHECK_OUT";

type ConsoleState = "idle" | "recording" | "uploading" | "processing" | "success" | "error";

type Props = {
  studentId: string;
  studentName: string;
  mode: SessionConsoleMode;
  lessonPart: SessionConsoleLessonPart;
  ongoingLessonSession?: SessionItem | null;
  onModeChange: (mode: SessionConsoleMode) => void;
  onLessonPartChange: (part: SessionConsoleLessonPart) => void;
  onRefresh: () => Promise<void> | void;
  onOpenProof: (logId: string) => void;
  recordingLock?: RecordingLockInfo;
  showModePicker?: boolean;
  autoStartOnMount?: boolean;
};

const MAX_SECONDS: Record<SessionConsoleMode, number> = {
  INTERVIEW: 60 * 60,
  LESSON_REPORT: 10 * 60,
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

export function StudentSessionConsole({
  studentId,
  studentName,
  mode,
  lessonPart,
  ongoingLessonSession,
  onModeChange,
  onLessonPartChange,
  onRefresh,
  onOpenProof,
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
  const [processingJobs, setProcessingJobs] = useState<Array<{ type?: string; status?: string; lastError?: string | null }>>([]);
  const [recoverableSessionId, setRecoverableSessionId] = useState<string | null>(null);
  const [recoverableConversationId, setRecoverableConversationId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const mimeTypeRef = useRef("audio/webm");
  const lockTokenRef = useRef<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStartedRef = useRef(false);

  const lessonFlowState = getLessonReportPartState(ongoingLessonSession?.parts ?? []);
  const lessonFlowMessage = buildLessonReportFlowMessage(ongoingLessonSession);

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
    };
  }, [releaseLockClient, stopHeartbeat]);

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

  const ensureGenerationStarted = useCallback(async (sessionId: string) => {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      setState("processing");
      setMessage(attempt === 0 ? "生成を開始しています。" : "生成開始を再試行しています。");
      const res = await fetch(`/api/sessions/${sessionId}/generate`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.conversationId) {
        return body.conversationId as string;
      }

      lastError = new Error(body?.error ?? "生成の開始に失敗しました。");
      await sleep(1200 * (attempt + 1));
    }

    throw lastError ?? new Error("生成の開始に失敗しました。");
  }, []);

  const pollConversation = useCallback(
    async (conversationId: string, sessionId?: string | null) => {
      const startedAt = Date.now();
      let retried = false;
      setState("processing");
      setMessage("文字起こしと会話ログ整理を進めています。");
      setRecoverableConversationId(conversationId);
      setRecoverableSessionId(sessionId ?? null);

      while (Date.now() - startedAt < 300000) {
        const res = await fetch(`/api/conversations/${conversationId}?process=1&brief=1`, {
          cache: "no-store",
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          await sleep(1500);
          continue;
        }
        setProcessingJobs(body?.conversation?.jobs ?? []);
        if (body?.conversation?.status === "ERROR") {
          if (!retried) {
            retried = true;
            setMessage("生成が一時的に止まったため、自動で再試行しています。");
            const retryRes = await fetch(`/api/conversations/${conversationId}/regenerate`, {
              method: "POST",
            });
            const retryBody = await retryRes.json().catch(() => ({}));
            if (retryRes.ok) {
              setProcessingJobs([]);
              await sleep(1200);
              continue;
            }
            throw new Error(retryBody?.error ?? "生成の再試行に失敗しました。");
          }
          throw new Error(
            body?.conversation?.jobs?.find?.((job: any) => job?.status === "ERROR")?.lastError ??
              "生成に失敗しました。"
          );
        }
        if (body?.conversation?.status === "DONE") {
          setCreatedConversationId(conversationId);
          setProcessingJobs(body?.conversation?.jobs ?? []);
          setRecoverableConversationId(null);
          setRecoverableSessionId(null);
          setState("success");
          setMessage("生成が完了しました。会話ログとおすすめの話題を確認できます。");
          await onRefresh();
          return;
        }
        await sleep(1500);
      }

      setCreatedConversationId(conversationId);
      setRecoverableConversationId(null);
      setRecoverableSessionId(null);
      setState("success");
      setMessage("生成に時間がかかっています。ログ詳細から続きの反映を確認できます。");
      await onRefresh();
    },
    [onRefresh]
  );

  const reset = useCallback(() => {
    setState("idle");
    setMessage("");
    setError(null);
    setSeconds(0);
    setIsPaused(false);
    setEstimatedSize("0 B");
    setCreatedConversationId(null);
    setProcessingJobs([]);
    setRecoverableSessionId(null);
    setRecoverableConversationId(null);
    autoStartedRef.current = false;
  }, []);

  const retryGeneration = useCallback(async () => {
    const sessionId = recoverableSessionId;
    const conversationId = recoverableConversationId;
    if (!sessionId && !conversationId) return;

    setError(null);
    setState("processing");
    setProcessingJobs([]);

    try {
      const resumedConversationId = conversationId
        ? (() => {
            return fetch(`/api/conversations/${conversationId}/regenerate`, {
              method: "POST",
            })
              .then(async (res) => {
                const body = await res.json().catch(() => ({}));
                if (!res.ok) {
                  throw new Error(body?.error ?? "生成の再開に失敗しました。");
                }
                return (body?.conversationId as string) ?? conversationId;
              });
          })()
        : ensureGenerationStarted(sessionId!);

      await pollConversation(await resumedConversationId, sessionId);
    } catch (nextError: any) {
      setState("error");
      setError(nextError?.message ?? "生成の再開に失敗しました。");
    }
  }, [ensureGenerationStarted, pollConversation, recoverableConversationId, recoverableSessionId]);

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
      let savedConversationId: string | null = null;
      let partSaved = false;

      setError(null);
      setMessage("音声を保存しています。");
      setState("uploading");
      setProcessingJobs([]);
      setRecoverableSessionId(null);
      setRecoverableConversationId(null);

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
        savedConversationId = body?.conversationId ?? null;

        const startedConversationId =
          body?.conversationId ??
          (body?.session?.status === "PROCESSING" ? await ensureGenerationStarted(sessionId) : null);
        savedConversationId = startedConversationId;

        if (startedConversationId) {
          await pollConversation(startedConversationId, sessionId);
        } else {
          setState("success");
          if (mode === "LESSON_REPORT" && lessonPart === "CHECK_IN") {
            onLessonPartChange("CHECK_OUT");
          }
          setMessage(
            mode === "INTERVIEW"
              ? "保存しました。面談ログはまもなく確認できます。"
              : lessonPart === "CHECK_IN"
                ? "チェックインを保存しました。次はチェックアウトを録音してください。"
                : body?.session?.status === "COLLECTING"
                  ? "チェックアウトを保存しました。チェックインを追加すると指導報告が自動生成されます。"
                  : "チェックアウトを保存しました。指導報告を生成中です。"
          );
          await onRefresh();
        }
      } catch (nextError: any) {
        setState("error");
        if (partSaved) {
          setRecoverableSessionId(savedSessionId);
          setRecoverableConversationId(savedConversationId);
          setError(nextError?.message ?? "音声は保存済みですが、生成の開始に失敗しました。");
        } else {
          setError(nextError?.message ?? "録音の保存に失敗しました。");
        }
      } finally {
        await finalizeLock();
      }
    },
    [
      ensureGenerationStarted,
      ensureLockForAudio,
      finalizeLock,
      lessonPart,
      mode,
      onLessonPartChange,
      onRefresh,
      pollConversation,
      resolveTargetSessionId,
    ]
  );

  const startRecording = useCallback(async () => {
    setError(null);
    setMessage("");
    setCreatedConversationId(null);
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
          await uploadAudioFile(file);
        } finally {
          stopTracks(mediaStreamRef.current);
          mediaStreamRef.current = null;
          mediaRecorderRef.current = null;
          chunksRef.current = [];
          setSeconds(0);
          setIsPaused(false);
        }
      };

      recorder.start(1000);
      setState("recording");
      setMessage(
        mode === "LESSON_REPORT" && lessonPart === "CHECK_IN"
          ? "録音を開始しました。終了すると音声を保存します。"
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
    recordingLock?.lock?.lockedByName,
    studentId,
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
      setCreatedConversationId(null);
      await uploadAudioFile(file);
    },
    [lockConflict, recordingLock?.lock?.lockedByName, uploadAudioFile]
  );

  const canRecord = !lockConflict && state !== "uploading" && state !== "processing";
  const canUpload = canRecord && state !== "recording";
  const canStartFromCircle = canRecord && state !== "recording";
  const generationProgress =
    state === "uploading" || state === "processing"
      ? buildConversationGenerationProgress({
          mode,
          stage: state === "uploading" ? "uploading" : "processing",
          jobs: processingJobs,
          lastError: error,
        })
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
                  lessonFlowState.hasReadyCheckIn
                    ? styles.lessonStepDone
                    : lessonPart === "CHECK_IN"
                      ? styles.lessonStepCurrent
                      : styles.lessonStepPending
                }`}
                onClick={() => onLessonPartChange("CHECK_IN")}
                disabled={state === "recording" || lessonFlowState.hasReadyCheckIn}
              >
                <span className={styles.lessonStepNum}>
                  {lessonFlowState.hasReadyCheckIn ? "✓" : "1"}
                </span>
                <span>チェックイン</span>
              </button>
              <div className={`${styles.lessonStepConnector} ${lessonFlowState.hasReadyCheckIn ? styles.lessonStepConnectorDone : ""}`} />
              <button
                type="button"
                className={`${styles.lessonStep} ${
                  lessonFlowState.hasReadyCheckOut
                    ? styles.lessonStepDone
                    : lessonPart === "CHECK_OUT"
                      ? styles.lessonStepCurrent
                      : !lessonFlowState.hasReadyCheckIn
                        ? styles.lessonStepLocked
                        : styles.lessonStepPending
                }`}
                onClick={() => onLessonPartChange("CHECK_OUT")}
                disabled={state === "recording" || !lessonFlowState.hasReadyCheckIn}
              >
                <span className={styles.lessonStepNum}>
                  {lessonFlowState.hasReadyCheckOut ? "✓" : !lessonFlowState.hasReadyCheckIn ? "🔒" : "2"}
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
                {lessonFlowState.hasReadyCheckIn && !lessonFlowState.hasReadyCheckOut
                  ? "チェックイン保存済み → チェックアウト待ち"
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
              {recoverableSessionId || recoverableConversationId ? (
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
                {createdConversationId ? <Button onClick={() => onOpenProof(createdConversationId)}>生成結果を確認</Button> : null}
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
