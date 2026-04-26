import {
  TeacherAppClientPlatform,
  TeacherAppDeviceAuthSessionStatus,
  TeacherAppDeviceStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { runWithDatabaseRetry } from "@/lib/db-retry";

const TEACHER_APP_LAST_SEEN_TOUCH_INTERVAL_MS = 60_000;

function normalizeDeviceRevokeReason(value: string | null | undefined) {
  const reason = value?.trim().slice(0, 240);
  return reason || "admin_device_revoke";
}

export async function registerTeacherAppDevice(input: {
  organizationId: string;
  configuredByUserId: string;
  label: string;
  clientPlatform?: TeacherAppClientPlatform | null;
  appVersion?: string | null;
  buildNumber?: string | null;
}) {
  const now = new Date();
  const label = input.label.trim();
  return prisma.teacherAppDevice.upsert({
    where: {
      organizationId_label: {
        organizationId: input.organizationId,
        label,
      },
    },
    update: {
      configuredByUserId: input.configuredByUserId,
      status: TeacherAppDeviceStatus.ACTIVE,
      lastClientPlatform: input.clientPlatform ?? undefined,
      lastAppVersion: input.appVersion ?? undefined,
      lastBuildNumber: input.buildNumber ?? undefined,
      lastAuthenticatedAt: now,
      lastSeenAt: now,
    },
    create: {
      organizationId: input.organizationId,
      configuredByUserId: input.configuredByUserId,
      label,
      status: TeacherAppDeviceStatus.ACTIVE,
      lastClientPlatform: input.clientPlatform ?? undefined,
      lastAppVersion: input.appVersion ?? undefined,
      lastBuildNumber: input.buildNumber ?? undefined,
      lastAuthenticatedAt: now,
      lastSeenAt: now,
    },
    select: {
      id: true,
      organizationId: true,
      label: true,
    },
  });
}

export async function loadActiveTeacherAppDevice(input: { deviceId: string; organizationId: string }) {
  return runWithDatabaseRetry("teacher-app-device-load", () =>
    prisma.teacherAppDevice.findFirst({
      where: {
        id: input.deviceId,
        organizationId: input.organizationId,
        status: TeacherAppDeviceStatus.ACTIVE,
      },
      select: {
        id: true,
        organizationId: true,
        label: true,
        status: true,
        lastSeenAt: true,
        lastAuthenticatedAt: true,
      },
    })
  );
}

export async function touchTeacherAppDeviceLastSeen(input: { deviceId: string; organizationId: string }) {
  await prisma.teacherAppDevice.updateMany({
    where: {
      id: input.deviceId,
      organizationId: input.organizationId,
      status: TeacherAppDeviceStatus.ACTIVE,
      OR: [
        { lastSeenAt: null },
        {
          lastSeenAt: {
            lt: new Date(Date.now() - TEACHER_APP_LAST_SEEN_TOUCH_INTERVAL_MS),
          },
        },
      ],
    },
    data: {
      lastSeenAt: new Date(),
    },
  });
}

export async function touchTeacherAppDeviceNativeClientState(input: {
  deviceId: string;
  organizationId: string;
  clientPlatform?: TeacherAppClientPlatform | null;
  appVersion?: string | null;
  buildNumber?: string | null;
  authenticatedAt?: Date | null;
}) {
  await prisma.teacherAppDevice.updateMany({
    where: {
      id: input.deviceId,
      organizationId: input.organizationId,
      status: TeacherAppDeviceStatus.ACTIVE,
    },
    data: {
      lastClientPlatform: input.clientPlatform ?? undefined,
      lastAppVersion: input.appVersion ?? undefined,
      lastBuildNumber: input.buildNumber ?? undefined,
      lastAuthenticatedAt: input.authenticatedAt ?? undefined,
      lastSeenAt: new Date(),
    },
  });
}

export async function updateTeacherAppDevicePushRegistration(input: {
  deviceId: string;
  organizationId: string;
  provider: "FCM";
  token: string;
  permissionStatus: "granted" | "denied" | "unknown";
}) {
  const token = input.token.trim();
  if (!token) {
    throw new Error("push token is required");
  }

  await prisma.teacherAppDevice.updateMany({
    where: {
      id: input.deviceId,
      organizationId: input.organizationId,
      status: TeacherAppDeviceStatus.ACTIVE,
    },
    data: {
      pushToken: token,
      pushTokenProvider: input.provider,
      pushNotificationPermission: input.permissionStatus,
      pushTokenUpdatedAt: new Date(),
      lastSeenAt: new Date(),
      lastPushError: null,
      lastPushErrorAt: null,
    },
  });
}

export async function clearTeacherAppDevicePushRegistration(input: {
  deviceId: string;
  organizationId: string;
  reason: string;
}) {
  await prisma.teacherAppDevice.updateMany({
    where: {
      id: input.deviceId,
      organizationId: input.organizationId,
    },
    data: {
      pushToken: null,
      pushTokenProvider: null,
      pushNotificationPermission: "denied",
      pushTokenUpdatedAt: new Date(),
      lastPushError: input.reason.slice(0, 500),
      lastPushErrorAt: new Date(),
    },
  });
}

export async function revokeTeacherAppDevice(input: {
  deviceId: string;
  organizationId: string;
  confirmLabel?: string | null;
  reason?: string | null;
}) {
  const reason = normalizeDeviceRevokeReason(input.reason);
  const confirmLabel = input.confirmLabel?.trim() ?? "";
  const revokedAt = new Date();

  return runWithDatabaseRetry("teacher-app-device-revoke", () =>
    prisma.$transaction(async (tx) => {
      const device = await tx.teacherAppDevice.findFirst({
        where: {
          id: input.deviceId,
          organizationId: input.organizationId,
        },
        select: {
          id: true,
          organizationId: true,
          label: true,
          status: true,
        },
      });

      if (!device) {
        return {
          ok: false as const,
          code: "not_found" as const,
        };
      }

      if (confirmLabel && confirmLabel !== device.label) {
        return {
          ok: false as const,
          code: "confirmation_mismatch" as const,
          device,
        };
      }

      const revokedSessions = await tx.teacherAppDeviceAuthSession.updateMany({
        where: {
          deviceId: device.id,
          organizationId: input.organizationId,
          status: TeacherAppDeviceAuthSessionStatus.ACTIVE,
        },
        data: {
          status: TeacherAppDeviceAuthSessionStatus.REVOKED,
          revokedAt,
          revokeReason: reason,
        },
      });

      const updatedDevice = await tx.teacherAppDevice.update({
        where: {
          id: device.id,
        },
        data: {
          status: TeacherAppDeviceStatus.REVOKED,
        },
        select: {
          id: true,
          organizationId: true,
          label: true,
          status: true,
          updatedAt: true,
        },
      });

      return {
        ok: true as const,
        alreadyRevoked: device.status === TeacherAppDeviceStatus.REVOKED,
        device: updatedDevice,
        reason,
        revokedAuthSessionCount: revokedSessions.count,
      };
    })
  );
}
