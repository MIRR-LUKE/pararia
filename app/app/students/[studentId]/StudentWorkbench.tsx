"use client";

import type { ReportItem, SessionItem } from "./roomTypes";
import type { SessionConsoleLessonPart, SessionConsoleMode } from "./StudentSessionConsole";

type Props = {
  panel: string;
  studentId: string;
  studentName: string;
  sessions: SessionItem[];
  reports: ReportItem[];
  selectedSessionIds: string[];
  onSelectedSessionIdsChange: (ids: string[]) => void;
  recordingMode: SessionConsoleMode;
  lessonPart: SessionConsoleLessonPart;
  proofLogId: string | null;
  recommendedAction: { label: string; note: string; onClick: () => void };
  onOpenRecording: (mode: SessionConsoleMode, part?: SessionConsoleLessonPart) => void;
  onOpenProcessing: () => void;
  onOpenProof: (logId: string) => void;
  onOpenReport: (options?: { sendReady?: boolean }) => void;
  onOpenGeneratedReport: () => void;
  onClosePanel: () => void;
  onRefresh: () => void;
};

// 右常設ワークベンチは主導線から外したため、旧実装の互換だけ残す。
export function StudentWorkbench(_props: Props) {
  return null;
}
