"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { RECORDING_LOCK_HEARTBEAT_MS } from "@/lib/recording/lockConstants";
import type { RecordingLockInfo } from "./roomTypes";
import styles from "./studentRecorder.module.css";

type Props = {
  studentName: string;
  studentId: string;
  fallbackLogId?: string;
  onLogCreated?: () => void;
  onOpenProof?: (logId: string) => void;
  /** 他ユーザーが録音ロック保持中のとき（サーバー基準） */
  recordingLock?: RecordingLockInfo;
};

type RecordingState = "idle" | "recording" | "processing" | "success" | "error";
const MAX_INTERVIEW_SECONDS = 60 * 60;

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function StudentRecorder({ studentName, studentId, onLogCreated, onOpenProof, recordingLock }: Props) {
  const [state, setState] = useState<RecordingState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState([8, 18, 12, 20, 10, 16, 22]);
  const [transcriptionProgress, setTranscriptionProgress] = useState(0);
  const [aiGenerationProgress, setAiGenerationProgress] = useState(0);
  const [stageLabel, setStageLabel] = useState("");
  const [currentStage, setCurrentStage] = useState<"transcription" | "aiGeneration">("transcription");
  const [logId, setLogId] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [estimatedSize, setEstimatedSize] = useState<string>("-");
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const lockTokenRef = useRef<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const foreignHeld =
    recordingLock?.active &&
    recordingLock.lock &&
    !recordingLock.lock.isHeldByViewer;
  const foreignLabel = foreignHeld
    ? `${recordingLock!.lock!.lockedByName} さんが${
        recordingLock!.lock!.mode === "LESSON_REPORT" ? "指導報告モード" : "面談モード"
      }で録音中です。閲覧はできますが、新しい録音はできません。`
    : null;

  const stopHeartbeat = () => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  };

  const startHeartbeat = (token: string) => {
    stopHeartbeat();
    heartbeatRef.current = setInterval(() => {
      void fetch(`/api/students/${studentId}/recording-lock`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lockToken: token }),
      });
    }, RECORDING_LOCK_HEARTBEAT_MS);
  };

  const acquireInterviewLock = async () => {
    const res = await fetch(`/api/students/${studentId}/recording-lock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "INTERVIEW" }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body?.error ?? "録音ロックの取得に失敗しました。");
    }
    return body.lockToken as string;
  };

  const releaseLockClient = useCallback(async (token: string) => {
    await fetch(`/api/students/${studentId}/recording-lock`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lockToken: token }),
    }).catch(() => {});
  }, [studentId]);

  const ensureLockTokenForUpload = async () => {
    if (lockTokenRef.current) return lockTokenRef.current;
    const token = await acquireInterviewLock();
    lockTokenRef.current = token;
    startHeartbeat(token);
    return token;
  };

  useEffect(() => {
    if (state !== "recording") return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [state]);

  useEffect(() => {
    if (state !== "recording") return;
    if (seconds < MAX_INTERVIEW_SECONDS) return;
    setStageLabel("60分に達したため、自動で録音を停止して処理に進みます。");
    stopRecording();
  }, [seconds, state]);

  useEffect(() => {
    if (state !== "recording") return;
    const interval = setInterval(() => {
      setLevels((prev) => prev.map(() => Math.max(6, Math.min(28, Math.random() * 32))));
    }, 180);
    return () => clearInterval(interval);
  }, [state]);

  useEffect(() => {
    return () => {
      try {
        mediaRecorderRef.current?.stop();
      } catch {
        // ignore cleanup errors
      }
      stopTracks(mediaStreamRef.current);
      stopHeartbeat();
      const t = lockTokenRef.current;
      lockTokenRef.current = null;
      if (t) void releaseLockClient(t);
    };
  }, [studentId, releaseLockClient]);

  const timeLabel = useMemo(() => {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }, [seconds]);

  const reset = () => {
    setState("idle");
    setError(null);
    setLogId(null);
    setTranscriptionProgress(0);
    setAiGenerationProgress(0);
    setStageLabel("");
    setSeconds(0);
    setEstimatedSize("-");
    setUploadedFileName(null);
  };

  const pollConversation = async (conversationId: string) => {
    const maxWaitTime = 300000;
    const pollInterval = 1500;
    const startTime = Date.now();
    let llmProgress = 0;

    const llmProgressInterval = setInterval(() => {
      llmProgress = Math.min(99, llmProgress + 1.5);
      setAiGenerationProgress(llmProgress);
    }, 800);

    try {
      while (Date.now() - startTime < maxWaitTime) {
        const statusRes = await fetch(`/api/conversations/${conversationId}?process=1&brief=1`, {
          cache: "no-store",
        });
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          const conversation = statusData.conversation;
          if (conversation.status === "ERROR") {
            const failedJob = Array.isArray(conversation.jobs)
              ? conversation.jobs.find((job: any) => job?.status === "ERROR")
              : null;
            throw new Error(failedJob?.lastError || "AI 生成に失敗しました。");
          }
          if (conversation.status === "DONE") {
            setAiGenerationProgress(100);
            setStageLabel("生成が完了しました。");
            setLogId(conversationId);
            setState("success");
            onLogCreated?.();
            return;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }

      setAiGenerationProgress(99);
      setStageLabel("生成に時間がかかっています。ログ詳細から進捗を確認できます。");
      setLogId(conversationId);
      setState("success");
      onLogCreated?.();
    } finally {
      clearInterval(llmProgressInterval);
    }
  };

  const uploadAudioFile = async (file: File) => {
    setState("processing");
    setTranscriptionProgress(0);
    setAiGenerationProgress(0);
    setCurrentStage("transcription");
    setStageLabel("面談音声を保存しています...");
    setLogId(null);
    setError(null);

    let uploadLockToken: string | null = null;
    try {
      uploadLockToken = await ensureLockTokenForUpload();
    } catch (e: any) {
      setError(e?.message ?? "録音ロックの取得に失敗しました。");
      setState("error");
      stopHeartbeat();
      lockTokenRef.current = null;
      return;
    }

    try {
      const createRes = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId,
          type: "INTERVIEW",
          title: `${new Date().toLocaleDateString("ja-JP")} 面談`,
        }),
      });
      const createBody = await createRes.json();
      if (!createRes.ok || !createBody?.session?.id) {
        throw new Error(createBody?.error ?? "面談セッションの作成に失敗しました。");
      }

      const form = new FormData();
      form.append("partType", "FULL");
      form.append("file", file);
      form.append("lockToken", uploadLockToken);

      setStageLabel("文字起こしを開始しています...");
      const progressTimer = setInterval(() => {
        setTranscriptionProgress((prev) => Math.min(95, prev + 3));
      }, 500);

      let partBody: any;
      try {
        const uploadRes = await fetch(`/api/sessions/${createBody.session.id}/parts`, {
          method: "POST",
          body: form,
        });
        partBody = await uploadRes.json();
        if (!uploadRes.ok) {
          throw new Error(partBody?.error ?? "音声アップロードに失敗しました。");
        }
      } finally {
        clearInterval(progressTimer);
      }

      setTranscriptionProgress(100);
      setCurrentStage("aiGeneration");
      setStageLabel("要点と次の行動を生成しています...");

      if (!partBody?.conversationId) {
        throw new Error("conversationId を取得できませんでした。");
      }

      await pollConversation(partBody.conversationId);
    } catch (e: any) {
      setError(e?.message ?? "音声の処理に失敗しました。");
      setState("error");
      setTranscriptionProgress(0);
      setAiGenerationProgress(0);
      setStageLabel("");
    } finally {
      stopHeartbeat();
      lockTokenRef.current = null;
    }
  };

  const startRecording = async () => {
    setError(null);
    setUploadedFileName(null);
    setLogId(null);
    setSeconds(0);
    setEstimatedSize("-");

    if (foreignHeld) {
      setError(foreignLabel ?? "ほかのユーザーが録音中です。");
      setState("error");
      return;
    }

    try {
      const token = await acquireInterviewLock();
      lockTokenRef.current = token;
      startHeartbeat(token);
    } catch (e: any) {
      setError(e?.message ?? "録音ロックの取得に失敗しました。");
      setState("error");
      return;
    }

    try {
      if (typeof window === "undefined") return;
      if (!window.isSecureContext) {
        setError("録音には HTTPS または localhost が必要です。");
        setState("error");
        return;
      }
      if (typeof MediaRecorder === "undefined") {
        setError("このブラウザは録音に対応していません。");
        setState("error");
        return;
      }

      const mimeCandidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
      const mimeType = mimeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (!mimeType) {
        setError("このブラウザでは音声録音を開始できません。");
        setState("error");
        return;
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

      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 64000,
      });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
          const totalBytes = chunksRef.current.reduce((acc, part) => {
            if (part instanceof Blob) return acc + part.size;
            return acc;
          }, 0);
          setEstimatedSize(formatBytes(totalBytes));
        }
      };

      recorder.onerror = () => {
        setError("録音中にエラーが発生しました。");
        setState("error");
        stopHeartbeat();
        const t = lockTokenRef.current;
        lockTokenRef.current = null;
        if (t) void releaseLockClient(t);
      };

      recorder.onstop = async () => {
        try {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          const file = new File(
            [blob],
            `interview-${studentId}-${new Date().toISOString().slice(0, 19)}.${mimeType.includes("ogg") ? "ogg" : "webm"}`,
            { type: mimeType }
          );
          setUploadedFileName(file.name);
          await uploadAudioFile(file);
        } finally {
          stopTracks(mediaStreamRef.current);
          mediaStreamRef.current = null;
          mediaRecorderRef.current = null;
          chunksRef.current = [];
        }
      };

      recorder.start(1000);
      setState("recording");
    } catch (e: any) {
      setError(e?.message ?? "録音を開始できませんでした。");
      setState("error");
      stopTracks(mediaStreamRef.current);
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;
      chunksRef.current = [];
      stopHeartbeat();
      const t = lockTokenRef.current;
      lockTokenRef.current = null;
      if (t) void releaseLockClient(t);
    }
  };

  const stopRecording = () => {
    try {
      mediaRecorderRef.current?.stop();
      setState("processing");
    } catch {
      // ignore stop errors
    }
  };

  const handleFileSelect = (file: File) => {
    if (foreignHeld) {
      setError(foreignLabel ?? "ほかのユーザーが録音中です。");
      setState("error");
      return;
    }
    if (file.type.startsWith("audio/") || file.name.match(/\.(webm|ogg|mp3|wav|m4a)$/i)) {
      setUploadedFileName(file.name);
      void uploadAudioFile(file);
    } else {
      setError("音声ファイルを選択してください。");
      setState("error");
    }
  };

  return (
    <div className={styles.recorderCard}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div>
            <h3 className={styles.title}>面談を録音</h3>
            <p className={styles.subtitle}>{studentName} さんとの面談を、そのまま次の会話とレポートの材料に変えます。</p>
          </div>
        </div>
        {state === "success" ? (
          <Button variant="secondary" size="small" onClick={reset}>
            もう一度録音
          </Button>
        ) : null}
      </div>

      <div className={styles.content}>
        {foreignLabel ? (
          <p className={styles.hint} role="status">
            {foreignLabel}
          </p>
        ) : null}

        {state === "idle" ? (
          <div
            className={`${styles.idleState} ${isDragging ? styles.dragging : ""}`}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              const file = event.dataTransfer.files[0];
              if (file) handleFileSelect(file);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
          >
            <button type="button" className={styles.recordButton} onClick={startRecording} disabled={!!foreignHeld}>
              <div className={styles.recordButtonInner} />
              <span className={styles.recordButtonLabel}>面談を録音</span>
            </button>
            <p className={styles.hint}>録音を止めたら、自動で文字起こしと要点生成を始めます。</p>
            <div className={styles.inlineActions}>
              <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={!!foreignHeld}>
                音声ファイルを選ぶ
              </Button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleFileSelect(file);
              }}
            />
          </div>
        ) : null}

        {state === "recording" ? (
          <div className={styles.recordingState}>
            <div className={styles.recordingVisual}>
              <div className={styles.recordingPulse} />
              <div className={styles.recordingCore} />
            </div>
            <div className={styles.recordingInfo}>
              <div className={styles.timeDisplay}>{timeLabel}</div>
              <div className={styles.audioLevels}>
                {levels.map((height, idx) => (
                  <div key={idx} className={styles.audioBar} style={{ height: `${height}px` }} />
                ))}
              </div>
              <button type="button" className={styles.stopButton} onClick={stopRecording}>
                停止して保存
              </button>
              <p className={styles.hint}>推定サイズ: {estimatedSize}</p>
            </div>
          </div>
        ) : null}

        {state === "processing" ? (
          <div className={styles.processingState} aria-live="polite">
            <h4 className={styles.processingTitle}>{stageLabel || "処理中です..."}</h4>
            {currentStage === "transcription" ? (
              <>
                <div className={styles.progressBar}>
                  <div className={styles.progressFill} style={{ width: `${transcriptionProgress}%` }} />
                </div>
                <p className={styles.progressText}>文字起こし {Math.round(transcriptionProgress)}%</p>
              </>
            ) : (
              <>
                <div className={styles.progressBar}>
                  <div className={styles.progressFill} style={{ width: `${aiGenerationProgress}%` }} />
                </div>
                <p className={styles.progressText}>AI 生成 {Math.round(aiGenerationProgress)}%</p>
              </>
            )}
            {uploadedFileName ? <p className={styles.hint}>ファイル: {uploadedFileName}</p> : null}
          </div>
        ) : null}

        {state === "success" && logId ? (
          <div className={styles.successState}>
            <h4 className={styles.processingTitle}>面談ログを更新しました</h4>
            <p className={styles.hint}>生徒ルームと会話ログ詳細に、要点と次の行動が反映されています。</p>
            <div className={styles.inlineActions}>
              {onOpenProof ? (
                <Button onClick={() => onOpenProof(logId)}>根拠を見る</Button>
              ) : (
                <Link href={`/app/students/${studentId}?panel=proof&logId=${logId}`}>
                  <Button>根拠を見る</Button>
                </Link>
              )}
              <Button variant="secondary" onClick={reset}>
                もう一度録音
              </Button>
            </div>
          </div>
        ) : null}

        {state === "error" ? (
          <div className={styles.errorState}>
            <h4 className={styles.processingTitle}>処理に失敗しました</h4>
            <p className={styles.hint}>{error}</p>
            <Button variant="secondary" onClick={reset}>
              やり直す
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
