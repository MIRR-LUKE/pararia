import { prisma } from "@/lib/db";
import { sendFcmMessage, type FcmSendResult } from "@/lib/push/fcm";
import {
  recordTeacherRecordingNotificationAttempt,
  type TeacherRecordingNotificationHistoryClient,
} from "@/lib/teacher-app/server/recording-notification-history";

type RecordingNotificationKind = "ready" | "error";

type TeacherRecordingNotificationMessage = {
  title: string;
  body: string;
  data: Record<string, string>;
};

type TeacherRecordingNotificationDevice = {
  id: string;
  organizationId: string;
  pushToken: string | null;
  pushTokenProvider: string | null;
  pushNotificationPermission: string | null;
};

type TeacherRecordingForNotification = {
  id: string;
  organizationId: string;
  deviceLabel: string;
  durationSeconds: number | null;
  device: TeacherRecordingNotificationDevice | null;
};

type RecordingNotificationDbClient = TeacherRecordingNotificationHistoryClient & {
  teacherRecordingSession: {
    findFirst(args: any): Promise<TeacherRecordingForNotification | null>;
  };
  teacherAppDevice: {
    updateMany(args: any): Promise<unknown>;
  };
};

type TeacherRecordingNotificationDeps = {
  db?: RecordingNotificationDbClient;
  sendMessage?: typeof sendFcmMessage;
  now?: () => Date;
};

function trimErrorMessage(message: string | null | undefined) {
  const trimmed = message?.trim();
  if (!trimmed) return "アプリを開いて内容を確認してください。";
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
}

export function buildTeacherRecordingNotificationMessage(input: {
  kind: RecordingNotificationKind;
  recordingId: string;
  deviceLabel: string;
  durationSeconds?: number | null;
  errorMessage?: string | null;
}): TeacherRecordingNotificationMessage {
  if (input.kind === "error") {
    return {
      title: "録音の文字起こしに失敗しました",
      body: trimErrorMessage(input.errorMessage),
      data: {
        kind: "teacher_recording_error",
        recordingId: input.recordingId,
        route: "recording_error",
        deviceLabel: input.deviceLabel,
      },
    };
  }

  return {
    title: "録音の文字起こしが完了しました",
    body: "アプリを開いて生徒を確認してください。",
    data: {
      kind: "teacher_recording_ready",
      recordingId: input.recordingId,
      route: "student_confirmation",
      deviceLabel: input.deviceLabel,
    },
  };
}

async function markPushOutcome(input: {
  db: RecordingNotificationDbClient;
  deviceId: string;
  organizationId: string;
  occurredAt: Date;
  sent: boolean;
  error?: string | null;
}) {
  await input.db.teacherAppDevice.updateMany({
    where: {
      id: input.deviceId,
      organizationId: input.organizationId,
    },
    data: input.sent
      ? {
          lastPushSentAt: input.occurredAt,
          lastPushError: null,
          lastPushErrorAt: null,
        }
      : {
          lastPushError: input.error?.slice(0, 500) || "push send failed",
          lastPushErrorAt: input.occurredAt,
        },
  });
}

async function clearInvalidToken(input: {
  db: RecordingNotificationDbClient;
  deviceId: string;
  organizationId: string;
  error: string;
  occurredAt: Date;
}) {
  if (!/UNREGISTERED|registration-token-not-registered|not found|invalid/i.test(input.error)) {
    return;
  }
  await input.db.teacherAppDevice.updateMany({
    where: {
      id: input.deviceId,
      organizationId: input.organizationId,
    },
    data: {
      pushToken: null,
      pushTokenProvider: null,
      pushTokenUpdatedAt: null,
      lastPushError: input.error.slice(0, 500),
      lastPushErrorAt: input.occurredAt,
    },
  });
}

async function recordPushOutcome(input: {
  db: RecordingNotificationDbClient;
  recording: TeacherRecordingForNotification;
  device: TeacherRecordingNotificationDevice | null;
  kind: RecordingNotificationKind;
  result: FcmSendResult;
  sentAt: Date;
}) {
  const { result } = input;
  await recordTeacherRecordingNotificationAttempt(input.db, {
    organizationId: input.recording.organizationId,
    recordingId: input.recording.id,
    deviceId: input.device?.id ?? null,
    sentAt: input.sentAt,
    kind: input.kind,
    success: result.ok && !result.skipped,
    skipped: result.skipped,
    failureReason: result.ok ? (result.skipped ? result.reason : null) : result.error,
    permissionStatus: input.device?.pushNotificationPermission ?? null,
    pushTokenProvider: input.device?.pushTokenProvider ?? null,
    fcmMessageName: result.ok && !result.skipped ? result.messageName : null,
    fcmStatus: !result.ok ? result.status ?? null : null,
  }).catch((error) => {
    console.warn("[teacher-recording-notifications] failed to record notification history", {
      recordingId: input.recording.id,
      deviceId: input.device?.id ?? null,
      kind: input.kind,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

export async function notifyTeacherRecordingDevice(
  input: {
    recordingId: string;
    organizationId: string;
    kind: RecordingNotificationKind;
    errorMessage?: string | null;
  },
  deps: TeacherRecordingNotificationDeps = {}
) {
  const db = (deps.db ?? prisma) as RecordingNotificationDbClient;
  const sendMessage = deps.sendMessage ?? sendFcmMessage;
  const now = deps.now ?? (() => new Date());

  const recording = await db.teacherRecordingSession.findFirst({
    where: {
      id: input.recordingId,
      organizationId: input.organizationId,
    },
    select: {
      id: true,
      organizationId: true,
      deviceLabel: true,
      durationSeconds: true,
      device: {
        select: {
          id: true,
          organizationId: true,
          pushToken: true,
          pushTokenProvider: true,
          pushNotificationPermission: true,
        },
      },
    },
  });

  const device = recording?.device;
  if (!recording) {
    return { ok: true, skipped: true, reason: "recording_device_missing" } as const;
  }
  if (!device?.id) {
    const result = { ok: true, skipped: true, reason: "recording_device_missing" } as const;
    await recordPushOutcome({
      db,
      recording,
      device: null,
      kind: input.kind,
      result,
      sentAt: now(),
    });
    return result;
  }
  if (!device.pushToken || device.pushTokenProvider !== "FCM") {
    const result = { ok: true, skipped: true, reason: "push_token_missing" } as const;
    await recordPushOutcome({
      db,
      recording,
      device,
      kind: input.kind,
      result,
      sentAt: now(),
    });
    return result;
  }
  if (device.pushNotificationPermission === "denied") {
    const result = { ok: true, skipped: true, reason: "notifications_denied" } as const;
    await recordPushOutcome({
      db,
      recording,
      device,
      kind: input.kind,
      result,
      sentAt: now(),
    });
    return result;
  }

  const message = buildTeacherRecordingNotificationMessage({
    kind: input.kind,
    recordingId: recording.id,
    deviceLabel: recording.deviceLabel,
    durationSeconds: recording.durationSeconds,
    errorMessage: input.errorMessage,
  });

  const result = await sendMessage({
    token: device.pushToken,
    notification: {
      title: message.title,
      body: message.body,
    },
    data: message.data,
  });
  const sentAt = now();

  if (result.ok && !result.skipped) {
    await markPushOutcome({
      db,
      deviceId: device.id,
      organizationId: device.organizationId,
      occurredAt: sentAt,
      sent: true,
    }).catch(() => {});
  } else if (!result.ok) {
    await markPushOutcome({
      db,
      deviceId: device.id,
      organizationId: device.organizationId,
      occurredAt: sentAt,
      sent: false,
      error: result.error,
    }).catch(() => {});
    await clearInvalidToken({
      db,
      deviceId: device.id,
      organizationId: device.organizationId,
      error: result.error,
      occurredAt: sentAt,
    }).catch(() => {});
  }

  await recordPushOutcome({
    db,
    recording,
    device,
    kind: input.kind,
    result,
    sentAt,
  });

  return result;
}

export async function notifyTeacherRecordingReady(input: {
  recordingId: string;
  organizationId: string;
}) {
  return notifyTeacherRecordingDevice({
    recordingId: input.recordingId,
    organizationId: input.organizationId,
    kind: "ready",
  });
}

export async function notifyTeacherRecordingError(input: {
  recordingId: string;
  organizationId: string;
  errorMessage: string;
}) {
  return notifyTeacherRecordingDevice({
    recordingId: input.recordingId,
    organizationId: input.organizationId,
    kind: "error",
    errorMessage: input.errorMessage,
  });
}
