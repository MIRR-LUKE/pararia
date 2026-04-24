export type LessonPartLike = {
  partType?: string | null;
  status?: string | null;
};

export type LessonSessionLike = {
  id?: string | null;
  type?: string | null;
  status?: string | null;
  parts?: LessonPartLike[] | null;
};

export type LessonReportPartState = {
  hasCheckIn: boolean;
  hasCheckOut: boolean;
  hasReadyCheckIn: boolean;
  hasReadyCheckOut: boolean;
  isComplete: boolean;
  nextRecommendedPart: "CHECK_IN" | "CHECK_OUT";
};

function isReadyPart(part: LessonPartLike, partType: "CHECK_IN" | "CHECK_OUT") {
  return part.partType === partType && part.status === "READY";
}

function isCollectedPart(part: LessonPartLike, partType: "CHECK_IN" | "CHECK_OUT") {
  return part.partType === partType && part.status !== "ERROR";
}

export function getLessonReportPartState(parts: LessonPartLike[] = []): LessonReportPartState {
  return {
    hasCheckIn: false,
    hasCheckOut: false,
    hasReadyCheckIn: false,
    hasReadyCheckOut: false,
    isComplete: false,
    nextRecommendedPart: "CHECK_IN",
  };
}

export function isLessonReportSessionOpenForCollection(session: LessonSessionLike | null | undefined) {
  if (!session || session.type !== "LESSON_REPORT") return false;
  return !getLessonReportPartState(session.parts ?? []).isComplete;
}

export function pickOngoingLessonReportSession<T extends LessonSessionLike>(sessions: T[] = []) {
  return null;
}

export function buildLessonReportFlowMessage(session: LessonSessionLike | null | undefined) {
  return "指導報告フローは無効化されました。面談ログのみ利用できます。";
}
