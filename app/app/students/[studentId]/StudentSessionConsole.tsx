"use client";

import { Badge } from "@/components/ui/Badge";
import { StudentRecorder } from "./StudentRecorder";
import { LessonReportComposer } from "./LessonReportComposer";
import styles from "./studentSessionConsole.module.css";

export type SessionConsoleMode = "INTERVIEW" | "LESSON_REPORT";
export type SessionConsoleLessonPart = "CHECK_IN" | "CHECK_OUT";

type Props = {
  studentId: string;
  studentName: string;
  mode: SessionConsoleMode;
  lessonPart: SessionConsoleLessonPart;
  onModeChange: (mode: SessionConsoleMode) => void;
  onLessonPartChange: (part: SessionConsoleLessonPart) => void;
  onRefresh: () => void;
  onOpenProof: (logId: string) => void;
};

const MODE_COPY: Record<SessionConsoleMode, { title: string; subtitle: string; bullets: string[]; limit: string }> = {
  INTERVIEW: {
    title: "面談モード",
    subtitle: "長めの会話をそのまま会話ログ、プロフィール更新、次に聞くことへ変換します。",
    bullets: [
      "会話ログに残る",
      "プロフィール更新に使う",
      "保護者レポート素材に使う",
      "指導報告書は作らない",
      "最大60分",
    ],
    limit: "最大60分",
  },
  LESSON_REPORT: {
    title: "指導報告モード",
    subtitle: "授業前後の短い会話を 1 セッションとして束ね、指導報告書まで自動で作ります。",
    bullets: [
      "会話ログに残る",
      "プロフィール更新に使う",
      "保護者レポート素材に使う",
      "指導報告書を作る",
      "1回10分まで",
    ],
    limit: "1回10分",
  },
};

export function StudentSessionConsole({
  studentId,
  studentName,
  mode,
  lessonPart,
  onModeChange,
  onLessonPartChange,
  onRefresh,
  onOpenProof,
}: Props) {
  const copy = MODE_COPY[mode];

  return (
    <div className={styles.console}>
      <div className={styles.modePicker} role="tablist" aria-label="録音モードの切り替え">
        <button
          type="button"
          className={`${styles.modeButton} ${mode === "INTERVIEW" ? styles.modeButtonActive : ""}`}
          onClick={() => onModeChange("INTERVIEW")}
        >
          <span className={styles.modeLabel}>面談モード</span>
          <span className={styles.modeHint}>深めの会話を残す</span>
        </button>
        <button
          type="button"
          className={`${styles.modeButton} ${mode === "LESSON_REPORT" ? styles.modeButtonActive : ""}`}
          onClick={() => onModeChange("LESSON_REPORT")}
        >
          <span className={styles.modeLabel}>指導報告モード</span>
          <span className={styles.modeHint}>授業前後を 1 セッションにする</span>
        </button>
      </div>

      <div className={styles.consoleHeader}>
        <div>
          <div className={styles.consoleEyebrow}>録音開始</div>
          <h3 className={styles.consoleTitle}>{copy.title}</h3>
          <p className={styles.consoleSubtitle}>{copy.subtitle}</p>
        </div>
        <Badge label={copy.limit} tone="neutral" />
      </div>

      <div className={styles.bulletGrid}>
        {copy.bullets.map((bullet) => (
          <div key={bullet} className={styles.bulletItem}>
            {bullet}
          </div>
        ))}
      </div>

      {mode === "LESSON_REPORT" ? (
        <div className={styles.lessonToolbar}>
          <div className={styles.toolbarLabel}>記録するタイミング</div>
          <div className={styles.segmented} role="tablist" aria-label="指導報告のサブタイプ">
            <button
              type="button"
              className={`${styles.segmentButton} ${lessonPart === "CHECK_IN" ? styles.segmentButtonActive : ""}`}
              onClick={() => onLessonPartChange("CHECK_IN")}
            >
              チェックイン
            </button>
            <button
              type="button"
              className={`${styles.segmentButton} ${lessonPart === "CHECK_OUT" ? styles.segmentButtonActive : ""}`}
              onClick={() => onLessonPartChange("CHECK_OUT")}
            >
              チェックアウト
            </button>
          </div>
        </div>
      ) : null}

      <div className={styles.embeddedSurface}>
        {mode === "INTERVIEW" ? (
          <StudentRecorder
            studentName={studentName}
            studentId={studentId}
            onLogCreated={onRefresh}
            onOpenProof={onOpenProof}
          />
        ) : (
          <LessonReportComposer
            studentName={studentName}
            studentId={studentId}
            preferredPartType={lessonPart}
            onCompleted={onRefresh}
            onOpenProof={onOpenProof}
          />
        )}
      </div>
    </div>
  );
}
