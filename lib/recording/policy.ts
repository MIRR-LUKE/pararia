export type RecordingSessionType = "INTERVIEW" | "LESSON_REPORT";

/** 両モード共通: これ未満の録音は保存せず録り直しにする（秒） */
export const DEFAULT_MIN_RECORDING_DURATION_SEC = 60;
export const DEFAULT_MAX_INTERVIEW_DURATION_SEC = 60 * 60;
export const DEFAULT_MAX_LESSON_PART_DURATION_SEC = 10 * 60;

export function getDefaultMaxRecordingDurationSeconds(sessionType: RecordingSessionType) {
  return sessionType === "LESSON_REPORT"
    ? DEFAULT_MAX_LESSON_PART_DURATION_SEC
    : DEFAULT_MAX_INTERVIEW_DURATION_SEC;
}

export function buildRecordingTooShortMessage(
  minSeconds = DEFAULT_MIN_RECORDING_DURATION_SEC
) {
  return `録音が${minSeconds}秒未満のため、ログ生成を開始できません。${minSeconds}秒以上録音するか、十分な長さの音声ファイルをアップロードしてください。`;
}

export function buildRecordingTooLongMessage(
  sessionType: RecordingSessionType,
  maxSeconds = getDefaultMaxRecordingDurationSeconds(sessionType)
) {
  return sessionType === "LESSON_REPORT"
    ? `指導報告のチェックイン / チェックアウト音声は1回${Math.floor(
        maxSeconds / 60
      )}分までです。音声を分割して保存してください。`
    : `面談音声は1回${Math.floor(maxSeconds / 60)}分までです。音声を分割して保存してください。`;
}

export function buildUnknownDurationMessage(sessionType: RecordingSessionType) {
  return sessionType === "LESSON_REPORT"
    ? "指導報告音声の長さを確認できませんでした。10分以内のファイルを選び直してください。"
    : "面談音声の長さを確認できませんでした。60分以内のファイルを選び直してください。";
}
