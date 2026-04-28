function parseRetentionDays(raw: string | undefined, fallback: number) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

export const DEFAULT_TEACHER_RECORDING_UNCONFIRMED_RETENTION_DAYS = 14;
export const DEFAULT_TEACHER_RECORDING_ERROR_RETENTION_DAYS = 30;
export const DEFAULT_TEACHER_RECORDING_NO_STUDENT_RETENTION_DAYS = 30;

export function getTeacherRecordingUnconfirmedRetentionDays() {
  return parseRetentionDays(
    process.env.PARARIA_TEACHER_RECORDING_UNCONFIRMED_RETENTION_DAYS,
    DEFAULT_TEACHER_RECORDING_UNCONFIRMED_RETENTION_DAYS
  );
}

export function getTeacherRecordingErrorRetentionDays() {
  return parseRetentionDays(
    process.env.PARARIA_TEACHER_RECORDING_ERROR_RETENTION_DAYS,
    DEFAULT_TEACHER_RECORDING_ERROR_RETENTION_DAYS
  );
}

export function getTeacherRecordingNoStudentRetentionDays() {
  return parseRetentionDays(
    process.env.PARARIA_TEACHER_RECORDING_NO_STUDENT_RETENTION_DAYS,
    DEFAULT_TEACHER_RECORDING_NO_STUDENT_RETENTION_DAYS
  );
}

export function getTeacherRecordingRetentionPolicy() {
  return {
    unconfirmedDays: getTeacherRecordingUnconfirmedRetentionDays(),
    errorDays: getTeacherRecordingErrorRetentionDays(),
    noStudentDays: getTeacherRecordingNoStudentRetentionDays(),
  };
}
