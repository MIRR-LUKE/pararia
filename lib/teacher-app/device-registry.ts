import { TeacherAppClientPlatform, TeacherAppDeviceStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { runWithDatabaseRetry } from "@/lib/db-retry";

const TEACHER_APP_LAST_SEEN_TOUCH_INTERVAL_MS = 60_000;

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
