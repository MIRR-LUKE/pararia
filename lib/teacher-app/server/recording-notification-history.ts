export type TeacherRecordingNotificationKindValue = "ready" | "error";

export type TeacherRecordingNotificationAttemptData = {
  organizationId: string;
  recordingId: string;
  deviceId: string | null;
  sentAt: Date;
  kind: "READY" | "ERROR";
  success: boolean;
  skipped: boolean;
  failureReason: string | null;
  permissionStatus: string;
  pushTokenProvider: string | null;
  fcmMessageName: string | null;
  fcmStatus: number | null;
};

export type TeacherRecordingNotificationHistoryClient = {
  teacherRecordingNotificationAttempt: {
    create(args: { data: TeacherRecordingNotificationAttemptData }): Promise<unknown>;
  };
};

function toDatabaseKind(kind: TeacherRecordingNotificationKindValue): TeacherRecordingNotificationAttemptData["kind"] {
  return kind === "error" ? "ERROR" : "READY";
}

function normalizeNullableText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizePermissionStatus(value: string | null | undefined) {
  return normalizeNullableText(value) ?? "unknown";
}

function trimFailureReason(value: string | null | undefined) {
  const normalized = normalizeNullableText(value);
  return normalized ? normalized.slice(0, 500) : null;
}

export function buildTeacherRecordingNotificationAttemptData(input: {
  organizationId: string;
  recordingId: string;
  deviceId?: string | null;
  sentAt: Date;
  kind: TeacherRecordingNotificationKindValue;
  success: boolean;
  skipped: boolean;
  failureReason?: string | null;
  permissionStatus?: string | null;
  pushTokenProvider?: string | null;
  fcmMessageName?: string | null;
  fcmStatus?: number | null;
}): TeacherRecordingNotificationAttemptData {
  return {
    organizationId: input.organizationId,
    recordingId: input.recordingId,
    deviceId: input.deviceId ?? null,
    sentAt: input.sentAt,
    kind: toDatabaseKind(input.kind),
    success: input.success,
    skipped: input.skipped,
    failureReason: trimFailureReason(input.failureReason),
    permissionStatus: normalizePermissionStatus(input.permissionStatus),
    pushTokenProvider: normalizeNullableText(input.pushTokenProvider),
    fcmMessageName: normalizeNullableText(input.fcmMessageName),
    fcmStatus: input.fcmStatus ?? null,
  };
}

export async function recordTeacherRecordingNotificationAttempt(
  db: TeacherRecordingNotificationHistoryClient,
  input: Parameters<typeof buildTeacherRecordingNotificationAttemptData>[0]
) {
  const data = buildTeacherRecordingNotificationAttemptData(input);
  await db.teacherRecordingNotificationAttempt.create({ data });
  return data;
}
