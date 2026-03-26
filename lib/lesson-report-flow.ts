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
  const hasCheckIn = parts.some((part) => isCollectedPart(part, "CHECK_IN"));
  const hasCheckOut = parts.some((part) => isCollectedPart(part, "CHECK_OUT"));
  const hasReadyCheckIn = parts.some((part) => isReadyPart(part, "CHECK_IN"));
  const hasReadyCheckOut = parts.some((part) => isReadyPart(part, "CHECK_OUT"));
  return {
    hasCheckIn,
    hasCheckOut,
    hasReadyCheckIn,
    hasReadyCheckOut,
    isComplete: hasCheckIn && hasCheckOut,
    nextRecommendedPart: hasCheckIn ? "CHECK_OUT" : "CHECK_IN",
  };
}

export function isLessonReportSessionOpenForCollection(session: LessonSessionLike | null | undefined) {
  if (!session || session.type !== "LESSON_REPORT") return false;
  return !getLessonReportPartState(session.parts ?? []).isComplete;
}

export function pickOngoingLessonReportSession<T extends LessonSessionLike>(sessions: T[] = []) {
  return sessions.find((session) => isLessonReportSessionOpenForCollection(session)) ?? null;
}

export function buildLessonReportFlowMessage(session: LessonSessionLike | null | undefined) {
  const state = getLessonReportPartState(session?.parts ?? []);
  if (!session) {
    return "① チェックインを保存 → ② チェックアウトを保存 → 指導報告を自動生成";
  }
  if (state.hasCheckIn && !state.hasCheckOut) {
    if (!state.hasReadyCheckIn) {
      return "チェックイン受付済み。裏で文字起こし中ですが、先にチェックアウトを録音できます。";
    }
    return "チェックイン保存済み。チェックアウトを録音すると指導報告を自動生成します。";
  }
  if (!state.hasCheckIn && state.hasCheckOut) {
    if (!state.hasReadyCheckOut) {
      return "チェックアウト受付済み。裏で文字起こし中ですが、必要なら先にチェックインを追加できます。";
    }
    return "チェックアウト保存済み。チェックインを追加すると指導報告を自動生成します。";
  }
  if (state.isComplete) {
    return "チェックイン・チェックアウトを受け付けました。指導報告ログを生成中です。";
  }
  return "① チェックインを保存 → ② チェックアウトを保存 → 指導報告を自動生成";
}
