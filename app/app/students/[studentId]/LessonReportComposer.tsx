"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import styles from "./studentRecorder.module.css";

type Props = {
  studentId: string;
  studentName: string;
  onCompleted?: () => void;
  onReportFromSession?: (sessionId: string) => void;
};

type PartType = "CHECK_IN" | "CHECK_OUT";
type PartStatus = "idle" | "recording" | "uploading" | "done" | "error";

type PartState = {
  transcript: string;
  file: File | null;
  status: PartStatus;
  message?: string;
};

const initialLevels = [8, 18, 12, 20, 10, 16, 22];
const MAX_LESSON_PART_SECONDS = 10 * 60;

const PART_COPY: Record<
  PartType,
  {
    label: string;
    helper: string;
    placeholder: string;
    doneMessage: string;
    recordingMessage: string;
  }
> = {
  CHECK_IN: {
    label: "授業前チェックイン",
    helper: "授業前の状態、今日見ること、最初に確認したいことを短く残します。",
    placeholder: "例: 今日の目標、授業前の様子、授業前に見たい論点をメモできます。",
    doneMessage: "授業前チェックインを保存しました。",
    recordingMessage: "授業前チェックインを録音しています。",
  },
  CHECK_OUT: {
    label: "授業後チェックアウト",
    helper: "授業でやったこと、詰まった点、次回までの引き継ぎを残します。",
    placeholder: "例: 今日やったこと、詰まった点、次回までの課題や保護者共有候補をメモできます。",
    doneMessage: "授業後チェックアウトを保存しました。",
    recordingMessage: "授業後チェックアウトを録音しています。",
  },
};

function createInitialPartState(): PartState {
  return {
    transcript: "",
    file: null,
    status: "idle",
  };
}

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function LessonReportComposer({ studentId, studentName, onCompleted, onReportFromSession }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [checkIn, setCheckIn] = useState<PartState>(createInitialPartState);
  const [checkOut, setCheckOut] = useState<PartState>(createInitialPartState);
  const [globalMessage, setGlobalMessage] = useState("");
  const [processing, setProcessing] = useState(false);
  const [recordingPartType, setRecordingPartType] = useState<PartType | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState(initialLevels);
  const [estimatedSize, setEstimatedSize] = useState("-");

  const checkInFileInputRef = useRef<HTMLInputElement | null>(null);
  const checkOutFileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const mimeTypeRef = useRef<string>("audio/webm");

  useEffect(() => {
    if (!recordingPartType) return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [recordingPartType]);

  useEffect(() => {
    if (!recordingPartType) return;
    if (seconds < MAX_LESSON_PART_SECONDS) return;
    setGlobalMessage("10分に達したため、自動で録音を停止して保存に進みます。");
    try {
      mediaRecorderRef.current?.stop();
    } catch {
      setPartState(recordingPartType, (prev) => ({
        ...prev,
        status: "error",
        message: "録音の停止に失敗しました。",
      }));
      setRecordingPartType(null);
    }
  }, [recordingPartType, seconds]);

  useEffect(() => {
    if (!recordingPartType) return;
    const interval = setInterval(() => {
      setLevels((prev) => prev.map(() => Math.max(6, Math.min(28, Math.random() * 32))));
    }, 180);
    return () => clearInterval(interval);
  }, [recordingPartType]);

  useEffect(() => {
    return () => {
      try {
        mediaRecorderRef.current?.stop();
      } catch {
        // ignore cleanup errors
      }
      stopTracks(mediaStreamRef.current);
    };
  }, []);

  const timeLabel = useMemo(() => {
    const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
    const remain = (seconds % 60).toString().padStart(2, "0");
    return `${minutes}:${remain}`;
  }, [seconds]);

  const readyCount = useMemo(
    () => [checkIn, checkOut].filter((part) => part.status === "done").length,
    [checkIn, checkOut]
  );

  const getPartState = (partType: PartType) => (partType === "CHECK_IN" ? checkIn : checkOut);

  const setPartState = (partType: PartType, next: React.SetStateAction<PartState>) => {
    if (partType === "CHECK_IN") {
      setCheckIn(next);
      return;
    }
    setCheckOut(next);
  };

  const ensureSession = async () => {
    if (sessionId) return sessionId;

    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studentId,
        type: "LESSON_REPORT",
        title: `${new Date().toLocaleDateString("ja-JP")} 指導報告`,
      }),
    });
    const body = await response.json();

    if (!response.ok || !body?.session?.id) {
      throw new Error(body?.error ?? "指導報告セッションの作成に失敗しました。");
    }

    setSessionId(body.session.id);
    return body.session.id as string;
  };

  const pollConversation = async (nextConversationId: string) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 300000) {
      const statusRes = await fetch(`/api/conversations/${nextConversationId}?process=1&brief=1`, {
        cache: "no-store",
      });
      if (statusRes.ok) {
        const body = await statusRes.json();
        const conversation = body.conversation;
        if (conversation.status === "ERROR") {
          throw new Error("指導報告の生成でエラーが発生しました。");
        }
        if (conversation.status === "DONE") {
          setConversationId(nextConversationId);
          setGlobalMessage("指導報告の生成が完了しました。レポートにもそのまま使えます。");
          onCompleted?.();
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    setConversationId(nextConversationId);
    setGlobalMessage("生成に時間がかかっています。ログ詳細から進捗を確認できます。");
    setProcessing(false);
  };

  const uploadPart = async (
    partType: PartType,
    payload?: { file?: File | null; transcript?: string }
  ) => {
    const nextSessionId = await ensureSession();
    const current = getPartState(partType);
    const file = payload?.file ?? current.file;
    const transcript = (payload?.transcript ?? current.transcript).trim();

    if (!file && !transcript) {
      setPartState(partType, (prev) => ({
        ...prev,
        status: "error",
        message: "録音、音声ファイル、またはテキストのいずれかを入れてください。",
      }));
      return;
    }

    setPartState(partType, (prev) => ({
      ...prev,
      file: file ?? prev.file,
      transcript: transcript || prev.transcript,
      status: "uploading",
      message: "保存しています...",
    }));
    setGlobalMessage("");

    try {
      const form = new FormData();
      form.append("partType", partType);
      if (file) {
        form.append("file", file);
      } else {
        form.append("transcript", transcript);
      }

      const response = await fetch(`/api/sessions/${nextSessionId}/parts`, {
        method: "POST",
        body: form,
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body?.error ?? "パートの保存に失敗しました。");
      }

      setPartState(partType, (prev) => ({
        ...prev,
        file: file ?? prev.file,
        transcript: transcript || prev.transcript,
        status: "done",
        message: PART_COPY[partType].doneMessage,
      }));

      if (body?.conversationId) {
        setProcessing(true);
        setGlobalMessage("2つの録音がそろったので、指導報告を自動生成しています...");
        await pollConversation(body.conversationId);
        setProcessing(false);
      } else {
        setGlobalMessage("もう一方のパートを保存すると、自動で指導報告を生成します。");
      }
    } catch (error: any) {
      setPartState(partType, (prev) => ({
        ...prev,
        status: "error",
        message: error?.message ?? "パートの保存に失敗しました。",
      }));
      setProcessing(false);
    }
  };

  const startRecording = async (partType: PartType) => {
    if (recordingPartType && recordingPartType !== partType) return;

    setGlobalMessage("");
    setConversationId(null);
    setSeconds(0);
    setLevels(initialLevels);
    setEstimatedSize("-");

    try {
      if (typeof window === "undefined") return;
      if (!window.isSecureContext) {
        throw new Error("録音には HTTPS または localhost が必要です。");
      }
      if (typeof MediaRecorder === "undefined") {
        throw new Error("このブラウザは録音に対応していません。");
      }

      const mimeCandidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
      const mimeType = mimeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (!mimeType) {
        throw new Error("このブラウザでは録音を開始できません。");
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
      setRecordingPartType(partType);

      setPartState(partType, (prev) => ({
        ...prev,
        status: "recording",
        message: PART_COPY[partType].recordingMessage,
      }));

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
        setPartState(partType, (prev) => ({
          ...prev,
          status: "error",
          message: "録音中にエラーが発生しました。",
        }));
        setRecordingPartType(null);
        stopTracks(mediaStreamRef.current);
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        chunksRef.current = [];
      };

      recorder.onstop = async () => {
        const activeMimeType = mimeTypeRef.current;
        try {
          const blob = new Blob(chunksRef.current, { type: activeMimeType });
          const ext = activeMimeType.includes("ogg") ? "ogg" : "webm";
          const file = new File(
            [blob],
            `${partType.toLowerCase()}-${studentId}-${new Date().toISOString().slice(0, 19)}.${ext}`,
            { type: activeMimeType }
          );

          setPartState(partType, (prev) => ({
            ...prev,
            file,
            status: "uploading",
            message: "録音を保存しています...",
          }));

          await uploadPart(partType, { file });
        } finally {
          stopTracks(mediaStreamRef.current);
          mediaStreamRef.current = null;
          mediaRecorderRef.current = null;
          chunksRef.current = [];
          setRecordingPartType(null);
          setSeconds(0);
          setEstimatedSize("-");
        }
      };

      recorder.start(1000);
    } catch (error: any) {
      setPartState(partType, (prev) => ({
        ...prev,
        status: "error",
        message: error?.message ?? "録音を開始できませんでした。",
      }));
      setRecordingPartType(null);
      stopTracks(mediaStreamRef.current);
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;
      chunksRef.current = [];
    }
  };

  const stopRecording = (partType: PartType) => {
    if (recordingPartType !== partType) return;
    try {
      mediaRecorderRef.current?.stop();
    } catch {
      setPartState(partType, (prev) => ({
        ...prev,
        status: "error",
        message: "録音の停止に失敗しました。",
      }));
      setRecordingPartType(null);
    }
  };

  const handleFileSelect = (partType: PartType, file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("audio/") && !file.name.match(/\.(webm|ogg|mp3|wav|m4a)$/i)) {
      setPartState(partType, (prev) => ({
        ...prev,
        status: "error",
        message: "音声ファイルを選択してください。",
      }));
      return;
    }

    setPartState(partType, (prev) => ({
      ...prev,
      file,
      status: "idle",
      message: `${file.name} を選択しました。`,
    }));
    void uploadPart(partType, { file });
  };

  const reset = () => {
    try {
      mediaRecorderRef.current?.stop();
    } catch {
      // ignore reset errors
    }
    stopTracks(mediaStreamRef.current);
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
    chunksRef.current = [];

    setSessionId(null);
    setConversationId(null);
    setCheckIn(createInitialPartState());
    setCheckOut(createInitialPartState());
    setProcessing(false);
    setGlobalMessage("");
    setRecordingPartType(null);
    setSeconds(0);
    setLevels(initialLevels);
    setEstimatedSize("-");
  };

  const partConfigs = [
    { partType: "CHECK_IN" as const, state: checkIn, fileInputRef: checkInFileInputRef },
    { partType: "CHECK_OUT" as const, state: checkOut, fileInputRef: checkOutFileInputRef },
  ];

  return (
    <div className={styles.recorderCard}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div>
            <h3 className={styles.title}>授業を始める</h3>
            <p className={styles.subtitle}>{studentName} さんの授業前後を 1 セッションとして束ね、指導報告に自動で変換します。</p>
          </div>
        </div>
        <Button variant="secondary" size="small" onClick={reset}>
          リセット
        </Button>
      </div>

      <div className={styles.content}>
        <div className={styles.stepStrip}>
          <div className={`${styles.stepChip} ${checkIn.status === "done" ? styles.stepDone : styles.stepActive}`}>1. 授業前チェックイン</div>
          <div className={`${styles.stepChip} ${checkOut.status === "done" ? styles.stepDone : ""}`}>2. 授業後チェックアウト</div>
          <div className={`${styles.stepChip} ${conversationId ? styles.stepDone : processing ? styles.stepActive : ""}`}>3. 自動生成</div>
        </div>

        <p className={styles.hint}>完了 {readyCount}/2 パート</p>

        <div className={styles.partGrid}>
          {partConfigs.map(({ partType, state, fileInputRef }) => {
            const copy = PART_COPY[partType];
            const isRecording = recordingPartType === partType;
            const hasActiveRecorder = recordingPartType !== null && recordingPartType !== partType;
            const disableActions = processing || hasActiveRecorder || state.status === "uploading";

            return (
              <div key={partType} className={styles.partCard}>
                <div className={styles.partHeader}>
                  <div>
                    <strong>{copy.label}</strong>
                    <p className={styles.metaText}>{copy.helper}</p>
                  </div>
                  {state.message ? <span className={styles.metaText}>{state.message}</span> : null}
                </div>

                {isRecording ? (
                  <div className={styles.recordingState}>
                    <div className={styles.recordingVisual}>
                      <div className={styles.recordingPulse} />
                      <div className={styles.recordingCore} />
                    </div>
                    <div className={styles.recordingInfo}>
                      <div className={styles.timeDisplay}>{timeLabel}</div>
                      <div className={styles.audioLevels}>
                        {levels.map((height, idx) => (
                          <div key={`${partType}-${idx}`} className={styles.audioBar} style={{ height: `${height}px` }} />
                        ))}
                      </div>
                      <button type="button" className={styles.stopButton} onClick={() => stopRecording(partType)}>
                        停止して保存
                      </button>
                      <p className={styles.hint}>推定サイズ: {estimatedSize}</p>
                    </div>
                  </div>
                ) : (
                  <div className={styles.partBody}>
                    <div className={styles.inlineActions}>
                      <button
                        type="button"
                        className={styles.recordButton}
                        onClick={() => void startRecording(partType)}
                        disabled={disableActions}
                      >
                        <div className={styles.recordButtonInner} />
                        <span className={styles.recordButtonLabel}>{copy.label}を録音</span>
                      </button>

                      <div className={styles.uploadBlock}>
                        <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={disableActions}>
                          音声ファイルを選ぶ
                        </Button>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="audio/*"
                          hidden
                          onChange={(event) => handleFileSelect(partType, event.target.files?.[0] ?? null)}
                        />
                        {state.file ? <span className={styles.metaText}>{state.file.name}</span> : null}
                      </div>
                    </div>

                    <textarea
                      value={state.transcript}
                      onChange={(event) =>
                        setPartState(partType, (prev) => ({
                          ...prev,
                          transcript: event.target.value,
                          status: prev.status === "done" ? "idle" : prev.status,
                        }))
                      }
                      rows={4}
                      placeholder={copy.placeholder}
                      className={styles.textarea}
                    />

                    <div className={styles.inlineActions}>
                      <Button
                        disabled={disableActions || !state.transcript.trim()}
                        onClick={() => void uploadPart(partType, { transcript: state.transcript })}
                      >
                        テキストを保存
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {processing ? <p className={styles.hint}>指導報告を生成しています...</p> : null}
        {globalMessage ? <p className={styles.hint}>{globalMessage}</p> : null}

        {conversationId ? (
          <div className={styles.inlineActions}>
            <Link href={`/app/logs/${conversationId}`}>
              <Button>根拠を見る</Button>
            </Link>
            {sessionId && onReportFromSession ? (
              <Button variant="secondary" onClick={() => onReportFromSession(sessionId)}>
                この内容でレポートを確認
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
