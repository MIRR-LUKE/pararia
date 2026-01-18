"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import styles from "./studentRecorder.module.css";

type Props = {
  studentName: string;
  studentId: string;
  fallbackLogId?: string;
  onLogCreated?: () => void;
};

type RecordingState = "idle" | "recording" | "processing" | "success" | "error";

export function StudentRecorder({ studentName, studentId, fallbackLogId, onLogCreated }: Props) {
  const [state, setState] = useState<RecordingState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState([8, 18, 12, 20, 10, 16, 22]);
  const [transcriptionProgress, setTranscriptionProgress] = useState(0);
  const [aiGenerationProgress, setAiGenerationProgress] = useState(0);
  const [transcriptionStage, setTranscriptionStage] = useState<string>("");
  const [currentStage, setCurrentStage] = useState<"transcription" | "aiGeneration">("transcription");
  const [transcribedLogId, setTranscribedLogId] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [estimatedSize, setEstimatedSize] = useState<string>("—");
  const [quality, setQuality] = useState<"standard" | "high">("high");
  const [isDragging, setIsDragging] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const dropZoneRef = useRef<HTMLDivElement | null>(null);

  const selectedBitsPerSecond = quality === "high" ? 96_000 : 64_000;

  useEffect(() => {
    if (state === "recording") {
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
    }
  }, [state]);

  useEffect(() => {
    if (state === "recording") {
    const interval = setInterval(() => {
      setLevels((prev) =>
        prev.map(() => Math.max(6, Math.min(28, Math.random() * 32)))
      );
    }, 180);
    return () => clearInterval(interval);
    }
  }, [state]);

  useEffect(() => {
    return () => {
      try {
        mediaRecorderRef.current?.stop();
      } catch {
        // ignore
      }
      stopTracks(mediaStreamRef.current);
      mediaRecorderRef.current = null;
      mediaStreamRef.current = null;
      chunksRef.current = [];
    };
  }, []);

  const timeLabel = useMemo(() => {
    const m = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }, [seconds]);

  const uploadAudioFile = async (file: File) => {
    setState("processing");
    setTranscriptionProgress(0);
    setAiGenerationProgress(0);
    setTranscriptionStage("音声ファイルをアップロード中...");
    setCurrentStage("transcription");
    setTranscribedLogId(null);
    setError(null);
    
    let progressInterval: NodeJS.Timeout | null = null;

    try {
      // ステージ1: 文字起こし中（0% → 100%）
      setTranscriptionProgress(0);
      setAiGenerationProgress(0);
      setTranscriptionStage("文字起こし中");
      setCurrentStage("transcription");
      
      const form = new FormData();
      form.append("file", file);
      form.append("studentId", recognizeStudentId(studentId));
      
      // 文字起こし中の進捗シミュレーション（0% → 99%）
      // ファイルサイズに応じて速度を調整し、確実に99%まで到達させる（100%はfetch完了後に設定）
      const fileSizeMB = file.size / (1024 * 1024);
      const whisperProgressSpeed = fileSizeMB > 5 ? 2.0 : fileSizeMB > 2 ? 2.5 : 3.0;
      let whisperProgressInterval: NodeJS.Timeout | null = null;
      
      whisperProgressInterval = setInterval(() => {
        setTranscriptionProgress((prev) => {
          if (prev >= 99) {
            if (whisperProgressInterval) {
              clearInterval(whisperProgressInterval);
              whisperProgressInterval = null;
            }
            return 99;
          }
          return Math.min(99, prev + whisperProgressSpeed);
        });
      }, 500); // 500msごとに更新
      
      let res: Response;
      try {
        res = await fetch("/api/audio", {
          method: "POST",
          body: form,
        });
      } catch (fetchError: any) {
        if (whisperProgressInterval) {
          clearInterval(whisperProgressInterval);
          whisperProgressInterval = null;
        }
        console.error("[StudentRecorder] Fetch error:", fetchError);
        throw new Error(`ネットワークエラー: ${fetchError?.message ?? "接続に失敗しました"}`);
      } finally {
        if (whisperProgressInterval) {
          clearInterval(whisperProgressInterval);
          whisperProgressInterval = null;
        }
      }
      
      // 文字起こし完了（確実に100%にしてから次のステージへ）
      setTranscriptionProgress(100);
      // 少し待ってから次のステージに移行（UIの更新を確実にする）
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (!res.ok) {
        let errorBody: any = {};
        try {
          errorBody = await res.json();
        } catch {
          const text = await res.text().catch(() => "");
          errorBody = { error: text || `HTTP ${res.status}` };
        }
        const errorMsg = errorBody?.error ?? `Upload failed (${res.status})`;
        console.error("[StudentRecorder] API error:", {
          status: res.status,
          statusText: res.statusText,
          error: errorBody,
        });
        throw new Error(errorMsg);
      }

      let body: {
        conversationId?: string;
        rawTextCleaned?: string;
        status?: string;
        jobs?: Array<{ id: string; type: string; status: string }>;
        error?: string;
      };
      try {
        body = await res.json();
      } catch (parseError: any) {
        console.error("[StudentRecorder] JSON parse error:", parseError);
        throw new Error("サーバーからの応答の解析に失敗しました");
      }

      if (!body.conversationId) {
        throw new Error("会話ログIDが取得できませんでした。");
      }

      // ステージ2: 会話ログをAI生成中（0% → 100%）
      setCurrentStage("aiGeneration");
      setAiGenerationProgress(0);
      setTranscriptionStage("会話ログをAI生成中");
      
      const maxWaitTime = 300000; // 5分
      const pollInterval = 2000; // 2秒ごと
      const startTime = Date.now();

      // LLM処理中の進捗シミュレーション（0% → 99%）
      // 完了検知時までに確実に99%に到達するように速度を調整
      let llmProgressInterval: NodeJS.Timeout | null = null;
      let llmProgress = 0;
      
      llmProgressInterval = setInterval(() => {
        llmProgress = Math.min(99, llmProgress + 1.5);
        setAiGenerationProgress(llmProgress);
      }, 800); // 800msごとに更新

      let done = false;
      while (!done && Date.now() - startTime < maxWaitTime) {
        try {
          // ジョブを進める（cronが無い環境のための保険）
          await fetch(`/api/jobs/run?limit=2`, { method: "POST" }).catch(() => null);

          const statusRes = await fetch(`/api/conversations/${body.conversationId}`);
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            const log = statusData.conversation;
            done = log.status === "DONE";

            if (done) {
              // インターバルを確実にクリア
              if (llmProgressInterval) {
                clearInterval(llmProgressInterval);
                llmProgressInterval = null;
              }
              // 進捗が99%未満なら99%にしてから100%にする
              if (llmProgress < 99) {
                setAiGenerationProgress(99);
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              // 100%にして完了表示
              setAiGenerationProgress(100);
              setTranscriptionStage("完了！");
              setTranscribedLogId(body.conversationId);
              setState("success");
              
              if (onLogCreated) {
                setTimeout(() => {
                  onLogCreated();
                }, 500);
              }
              break;
            }
          }
        } catch (pollError) {
          console.error("[StudentRecorder] Poll error:", pollError);
          // ポーリングエラーは無視して続行
        }

        if (!done) {
          await new Promise((resolve) => setTimeout(resolve, pollInterval));
        }
      }

      // ループを抜けた後も確実にインターバルをクリア
      if (llmProgressInterval) {
        clearInterval(llmProgressInterval);
        llmProgressInterval = null;
      }

      if (!done) {
        // タイムアウトした場合でも、ログIDは設定して成功とする（ユーザーは全文を読める）
        console.warn("[StudentRecorder] LLM processing timeout, but log is available");
        setAiGenerationProgress(99);
        setTranscriptionStage("生成に時間がかかっています（全文は読めます）");
        setTranscribedLogId(body.conversationId);
        setState("success");
        
        if (onLogCreated) {
          setTimeout(() => {
            onLogCreated();
          }, 500);
        }
      }
    } catch (e: any) {
      console.error("[StudentRecorder] Upload failed:", e);
      setError(e?.message ?? "音声の保存/解析に失敗しました");
      setState("error");
      setTranscriptionProgress(0);
      setAiGenerationProgress(0);
      setTranscriptionStage("");
    } finally {
      if (progressInterval) {
        clearInterval(progressInterval);
      }
      setTimeout(() => {
        if (state !== "success") {
          setTranscriptionProgress(0);
          setAiGenerationProgress(0);
          setTranscriptionStage("");
        }
      }, 2000);
    }
  };

  const startRecording = async () => {
    setError(null);
    setUploadedFileName(null);
    setTranscribedLogId(null);
    setSeconds(0);
    setEstimatedSize("—");

    try {
      if (typeof window === "undefined") return;
      if (!window.isSecureContext) {
        setError("録音にはHTTPS（またはlocalhost）が必要です。");
        setState("error");
        return;
      }
      if (typeof MediaRecorder === "undefined") {
        setError("このブラウザは録音に未対応です。Chrome/Edgeをお試しください。");
        setState("error");
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("この環境ではマイク入力が利用できません。");
        setState("error");
        return;
      }

      const mimeCandidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
      ];
      const mimeType = mimeCandidates.find((t) => MediaRecorder.isTypeSupported(t));
      if (!mimeType) {
        setError("このブラウザはWebM/Opus録音に対応していません。");
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
        audioBitsPerSecond: selectedBitsPerSecond,
      });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (evt) => {
        if (evt.data && evt.data.size > 0) {
          chunksRef.current.push(evt.data);
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
      };

      recorder.onstop = async () => {
        try {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          const filename = `conversation-${studentId}-${new Date().toISOString().slice(0, 19)}.${mimeType.includes("ogg") ? "ogg" : "webm"}`;
          const file = new File([blob], filename, { type: mimeType });
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
      const msg =
        e?.name === "NotAllowedError"
          ? "マイク権限が拒否されています。ブラウザの設定からマイク許可をONにしてください。"
          : e?.name === "NotFoundError"
            ? "マイクが見つかりません。接続/OS設定をご確認ください。"
            : e?.message ?? "録音の開始に失敗しました。";
      setError(msg);
      setState("error");
      stopTracks(mediaStreamRef.current);
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;
      chunksRef.current = [];
    }
  };

  const stopRecording = () => {
    try {
      mediaRecorderRef.current?.stop();
    } catch {
      // ignore
    }
    setState("processing");
  };

  const handleFileSelect = (file: File) => {
    if (file.type.startsWith("audio/") || file.name.match(/\.(webm|ogg|mp3|wav|m4a)$/i)) {
    setUploadedFileName(file.name);
      uploadAudioFile(file);
    } else {
      setError("音声ファイルを選択してください。");
      setState("error");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (state !== "idle" && state !== "error") return;
    
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (state === "idle" || state === "error") {
      setIsDragging(true);
    }
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const reset = () => {
    setState("idle");
    setError(null);
    setTranscribedLogId(null);
    setTranscriptionProgress(0);
    setTranscriptionStage("");
    setSeconds(0);
    setEstimatedSize("—");
  };

  return (
    <div className={styles.recorderCard}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.iconWrapper}>
            <Icon name="logs" size={24} />
          </div>
          <div>
            <h3 className={styles.title}>会話ログを録音</h3>
            <p className={styles.subtitle}>{studentName} さんとの会話を記録</p>
          </div>
        </div>
        {state === "success" && (
          <Button variant="secondary" size="small" onClick={reset}>
            新しい録音
          </Button>
        )}
      </div>

      <div className={styles.content}>
        {/* 録音ボタンエリア */}
        {state === "idle" && (
          <div className={styles.idleState}>
      <button
        type="button"
              className={styles.recordButton}
              onClick={startRecording}
              aria-label="録音を開始"
            >
              <div className={styles.recordButtonInner}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" fill="#dc2626" />
                  <circle cx="12" cy="12" r="6" fill="#fff" />
                </svg>
              </div>
              <span className={styles.recordButtonLabel}>録音を開始</span>
      </button>
            <p className={styles.hint}>
              ボタンを押すと録音が始まります
            </p>
          </div>
        )}

        {/* 録音中 */}
        {state === "recording" && (
          <div className={styles.recordingState}>
            <div className={styles.recordingVisual}>
              <div className={styles.recordingPulse} />
              <div className={styles.recordingIcon}>
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" fill="#dc2626" />
                  <circle cx="12" cy="12" r="6" fill="#fff" />
                </svg>
        </div>
        </div>
            <div className={styles.recordingInfo}>
              <div className={styles.timeDisplay}>{timeLabel}</div>
              <div className={styles.audioLevels}>
            {levels.map((height, idx) => (
              <div
                key={idx}
                    className={styles.audioBar}
                    style={{ height: `${height}px` }}
                  />
                ))}
              </div>
              <button
                type="button"
                className={styles.stopButton}
                onClick={stopRecording}
              >
                停止して保存
              </button>
            </div>
          </div>
        )}

        {/* 処理中 */}
        {state === "processing" && (
          <div className={styles.processingState}>
            <div className={styles.processingIcon}>
              <div className={styles.spinner} />
            </div>
            <div className={styles.processingInfo}>
              <h4 className={styles.processingTitle}>
                {transcriptionStage || "処理中..."}
              </h4>
              
              {/* 文字起こしプログレスバー */}
              {currentStage === "transcription" && (
                <>
                  <div className={styles.progressBar}>
                    <div
                      className={styles.progressFill}
                      style={{
                        width: `${transcriptionProgress}%`,
                        background: "linear-gradient(90deg, #3b82f6, #2563eb)",
                      }}
                    />
                  </div>
                  <p className={styles.progressText}>
                    文字起こし: {Math.round(transcriptionProgress)}% 完了
                  </p>
                </>
              )}
              
              {/* AI生成プログレスバー */}
              {currentStage === "aiGeneration" && (
                <>
                  <div className={styles.progressBar}>
                    <div
                      className={styles.progressFill}
                      style={{
                        width: `${aiGenerationProgress}%`,
                        background: "linear-gradient(90deg, #8b5cf6, #7c3aed)",
                      }}
                    />
                  </div>
                  <p className={styles.progressText}>
                    AI生成: {Math.round(aiGenerationProgress)}% 完了
                    <span className={styles.progressNote}>
                      {" "}• 会話の長さによって時間がかかります
                    </span>
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {/* 成功 */}
        {state === "success" && (
          <div className={styles.successState}>
            <div className={styles.successIcon}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" fill="#10b981" />
                <path
                  d="M8 12l2 2 4-4"
                  stroke="#fff"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h4 className={styles.successTitle}>会話ログが作成されました！</h4>
            <p className={styles.successText}>
              自動的に構造化され、生徒カルテが更新されました。
            </p>
            {transcribedLogId && (
              <a
                href={`/app/logs/${transcribedLogId}`}
                className={styles.viewLogLink}
              >
                ログを確認する →
              </a>
            )}
          </div>
        )}

        {/* エラー */}
        {state === "error" && (
          <div className={styles.errorState}>
            <div className={styles.errorIcon}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" fill="#dc2626" />
                <path
                  d="M12 8v4M12 16h.01"
                  stroke="#fff"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <h4 className={styles.errorTitle}>エラーが発生しました</h4>
            <p className={styles.errorText}>{error}</p>
            <Button variant="primary" onClick={reset}>
              もう一度試す
          </Button>
          </div>
        )}

        {/* ファイルアップロード（ドラッグ&ドロップ） */}
        {(state === "idle" || state === "error") && (
          <div
            ref={dropZoneRef}
            className={`${styles.dropZone} ${isDragging ? styles.dragging : ""}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <Icon name="upload" size={32} />
            <p className={styles.dropZoneText}>
              {isDragging ? "ここにドロップ" : "音声ファイルをドラッグ&ドロップ"}
            </p>
            <p className={styles.dropZoneHint}>
              またはクリックしてファイルを選択
            </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
              }}
          />
        </div>
        )}

        {/* 設定（録音待機中のみ） */}
        {state === "idle" && (
          <div className={styles.settings}>
            <label className={styles.settingLabel}>
              <span>録音品質</span>
              <select
                className={styles.qualitySelect}
                value={quality}
                onChange={(e) => setQuality(e.target.value as any)}
              >
                <option value="high">高音質（96kbps）</option>
                <option value="standard">標準（64kbps）</option>
              </select>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

function stopTracks(stream: MediaStream | null) {
  if (!stream) return;
  try {
    stream.getTracks().forEach((t) => t.stop());
  } catch {
    // ignore
  }
}

function formatBytes(bytes: number) {
  if (!bytes) return "0B";
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)}KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)}MB`;
}

function recognizeStudentId(id: string) {
  return id;
}
