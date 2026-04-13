"use client";

import Image from "next/image";
import { memo } from "react";
import { Button } from "@/components/ui/Button";
import type { ConsoleState } from "./studentSessionConsoleTypes";
import styles from "./studentSessionConsole.module.css";

type Props = {
  state: ConsoleState;
  currentModeLabel: string | null;
  currentStudentLabel: string;
  statusLine: string;
  lessonMetaLine: string | null;
  lessonGuide: string | null;
  canStartFromCircle: boolean;
  isPaused: boolean;
  levels: number[];
  seconds: number;
  estimatedSize: string;
  canFinishRecording: boolean;
  remainingSecondsUntilSavable: number;
  onStartRecording: () => void;
  onTogglePause: () => void;
  onRequestCancelRecording: () => void;
  onStopRecording: () => void;
};

function StudentSessionConsoleRecordingSectionInner({
  state,
  currentModeLabel,
  currentStudentLabel,
  statusLine,
  lessonMetaLine,
  lessonGuide,
  canStartFromCircle,
  isPaused,
  levels,
  seconds,
  estimatedSize,
  canFinishRecording,
  remainingSecondsUntilSavable,
  onStartRecording,
  onTogglePause,
  onRequestCancelRecording,
  onStopRecording,
}: Props) {
  return (
    <div className={styles.recorderArea}>
      <button
        type="button"
        className={`${styles.microphoneCircle} ${canStartFromCircle ? styles.microphoneButton : styles.microphoneButtonDisabled}`}
        onClick={onStartRecording}
        disabled={!canStartFromCircle}
        aria-label="録音を開始する"
        data-testid="recording-start-button"
      >
        <Image src="/icons/mic-icon.svg" alt="" aria-hidden width={14} height={19} className={styles.microphoneGlyph} />
      </button>

      <div className={styles.recorderMeta}>
        {currentModeLabel ? <div className={styles.currentMode}>{currentModeLabel}</div> : null}
        <div className={styles.currentStudent}>{currentStudentLabel}</div>
        <div className={styles.statusLine}>{statusLine}</div>
        {lessonMetaLine ? <div className={styles.lessonMeta}>{lessonMetaLine}</div> : null}
      </div>

      {lessonGuide ? (
        <div className={styles.lessonGuide}>
          <p>{lessonGuide}</p>
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
            <Button variant="secondary" onClick={onTogglePause}>
              {isPaused ? "再開" : "一時停止"}
            </Button>
            <Button variant="secondary" onClick={onRequestCancelRecording}>
              キャンセル
            </Button>
            <Button onClick={onStopRecording} disabled={!canFinishRecording} data-testid="recording-stop-button">
              終了
            </Button>
          </div>
          <div className={styles.supportLine}>
            現在のサイズ: {estimatedSize}
            {!canFinishRecording ? ` / 保存できるまであと${remainingSecondsUntilSavable}秒` : ""}
          </div>
        </>
      ) : state === "preparing" ? (
        <div className={styles.processingBox}>
          <strong>録音準備中</strong>
          <p>{statusLine}</p>
        </div>
      ) : null}
    </div>
  );
}

StudentSessionConsoleRecordingSectionInner.displayName = "StudentSessionConsoleRecordingSection";

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export const StudentSessionConsoleRecordingSection = memo(StudentSessionConsoleRecordingSectionInner);
