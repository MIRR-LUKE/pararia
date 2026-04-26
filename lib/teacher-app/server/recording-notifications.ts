import { prisma } from "@/lib/db";
import { sendFcmMessage } from "@/lib/push/fcm";

type RecordingNotificationKind = "ready" | "error";

type TeacherRecordingNotificationMessage = {
  title: string;
  body: string;
  data: Record<string, string>;
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
  deviceId: string;
  organizationId: string;
  sent: boolean;
  error?: string | null;
}) {
  await prisma.teacherAppDevice.updateMany({
    where: {
      id: input.deviceId,
      organizationId: input.organizationId,
    },
    data: input.sent
      ? {
          lastPushSentAt: new Date(),
          lastPushError: null,
          lastPushErrorAt: null,
        }
      : {
          lastPushError: input.error?.slice(0, 500) || "push send failed",
          lastPushErrorAt: new Date(),
        },
  });
}

async function clearInvalidToken(input: {
  deviceId: string;
  organizationId: string;
  error: string;
}) {
  if (!/UNREGISTERED|registration-token-not-registered|not found|invalid/i.test(input.error)) {
    return;
  }
  await prisma.teacherAppDevice.updateMany({
    where: {
      id: input.deviceId,
      organizationId: input.organizationId,
    },
    data: {
      pushToken: null,
      pushTokenProvider: null,
      pushTokenUpdatedAt: null,
      lastPushError: input.error.slice(0, 500),
      lastPushErrorAt: new Date(),
    },
  });
}

export async function notifyTeacherRecordingDevice(input: {
  recordingId: string;
  organizationId: string;
  kind: RecordingNotificationKind;
  errorMessage?: string | null;
}) {
  const recording = await prisma.teacherRecordingSession.findFirst({
    where: {
      id: input.recordingId,
      organizationId: input.organizationId,
    },
    select: {
      id: true,
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
  if (!recording || !device?.id) {
    return { ok: true, skipped: true, reason: "recording_device_missing" } as const;
  }
  if (!device.pushToken || device.pushTokenProvider !== "FCM") {
    return { ok: true, skipped: true, reason: "push_token_missing" } as const;
  }
  if (device.pushNotificationPermission === "denied") {
    return { ok: true, skipped: true, reason: "notifications_denied" } as const;
  }

  const message = buildTeacherRecordingNotificationMessage({
    kind: input.kind,
    recordingId: recording.id,
    deviceLabel: recording.deviceLabel,
    durationSeconds: recording.durationSeconds,
    errorMessage: input.errorMessage,
  });

  const result = await sendFcmMessage({
    token: device.pushToken,
    notification: {
      title: message.title,
      body: message.body,
    },
    data: message.data,
  });

  if (result.ok && !result.skipped) {
    await markPushOutcome({
      deviceId: device.id,
      organizationId: device.organizationId,
      sent: true,
    }).catch(() => {});
  } else if (!result.ok) {
    await markPushOutcome({
      deviceId: device.id,
      organizationId: device.organizationId,
      sent: false,
      error: result.error,
    }).catch(() => {});
    await clearInvalidToken({
      deviceId: device.id,
      organizationId: device.organizationId,
      error: result.error,
    }).catch(() => {});
  }

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
