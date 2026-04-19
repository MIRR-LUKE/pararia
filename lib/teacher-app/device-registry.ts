import { TeacherAppDeviceStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

export async function registerTeacherAppDevice(input: {
  organizationId: string;
  configuredByUserId: string;
  label: string;
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
      lastAuthenticatedAt: now,
      lastSeenAt: now,
    },
    create: {
      organizationId: input.organizationId,
      configuredByUserId: input.configuredByUserId,
      label,
      status: TeacherAppDeviceStatus.ACTIVE,
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
  return prisma.teacherAppDevice.findFirst({
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
  });
}

export async function touchTeacherAppDeviceLastSeen(input: { deviceId: string; organizationId: string }) {
  await prisma.teacherAppDevice.updateMany({
    where: {
      id: input.deviceId,
      organizationId: input.organizationId,
      status: TeacherAppDeviceStatus.ACTIVE,
    },
    data: {
      lastSeenAt: new Date(),
    },
  });
}
