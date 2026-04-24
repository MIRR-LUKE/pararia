export type RecordingSessionType = "INTERVIEW";

/** 両モード共通: これ未満の録音は保存せず録り直しにする（秒） */
export const DEFAULT_MIN_RECORDING_DURATION_SEC = 60;
export const DEFAULT_MAX_INTERVIEW_DURATION_SEC = 120 * 60;

export function getDefaultMaxRecordingDurationSeconds(sessionType: RecordingSessionType) {
  return DEFAULT_MAX_INTERVIEW_DURATION_SEC;
}

export function buildRecordingTooShortMessage(
  minSeconds = DEFAULT_MIN_RECORDING_DURATION_SEC
) {
  return `録音が${minSeconds}秒未満のため、ログ生成を開始できません。${minSeconds}秒以上録音するか、十分な長さの音声ファイルをアップロードしてください。`;
}

export function buildRecordingDurationLimitLabel(
  sessionType: RecordingSessionType,
  maxSeconds = getDefaultMaxRecordingDurationSeconds(sessionType)
) {
  const minutes = Math.floor(maxSeconds / 60);
  return `${minutes}分`;
}

export function buildRecordingTooLongMessage(
  sessionType: RecordingSessionType,
  maxSeconds = getDefaultMaxRecordingDurationSeconds(sessionType)
) {
  return `面談音声は1回${buildRecordingDurationLimitLabel(sessionType, maxSeconds)}までです。音声を分割して保存してください。`;
}

export function buildUnknownDurationMessage(
  sessionType: RecordingSessionType,
  maxSeconds = getDefaultMaxRecordingDurationSeconds(sessionType)
) {
  return `面談音声の長さを確認できませんでした。${buildRecordingDurationLimitLabel(
    sessionType,
    maxSeconds
  )}以内のファイルを選び直してください。`;
}

export function buildRecordingAutoStopMessage(
  sessionType: RecordingSessionType,
  maxSeconds = getDefaultMaxRecordingDurationSeconds(sessionType)
) {
  return `${buildRecordingDurationLimitLabel(sessionType, maxSeconds)}に達したため、自動で録音を停止して保存します。`;
}

export function buildRecordingSaveBeforeContinuingMessage(
  sessionType: RecordingSessionType,
  maxSeconds = getDefaultMaxRecordingDurationSeconds(sessionType)
) {
  return `面談の録音は${buildRecordingDurationLimitLabel(
    sessionType,
    maxSeconds
  )}までです。録音を保存してから次へ進んでください。`;
}

export function buildRecordingSplitBeforeContinuingMessage(
  sessionType: RecordingSessionType,
  maxSeconds = getDefaultMaxRecordingDurationSeconds(sessionType)
) {
  return `面談の録音は${buildRecordingDurationLimitLabel(
    sessionType,
    maxSeconds
  )}までです。録音を分けて保存してください。`;
}
