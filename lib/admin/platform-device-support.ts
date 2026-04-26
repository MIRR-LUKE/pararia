import {
  TeacherAppDeviceAuthSessionStatus,
  TeacherAppDeviceStatus,
  type TeacherAppClientPlatform,
  type UserRole,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import type { PlatformOperatorContext } from "./platform-admin-types";
import { assertPlatformAdminReadable } from "./platform-operators";

export type AdminTeacherAppDeviceSupportSnapshot = {
  generatedAt: string;
  campus: {
    id: string;
    name: string;
    planCode: string;
  };
  users: {
    total: number;
    byRole: Record<string, number>;
    pendingInvitationCount: number;
    expiredInvitationCount: number;
    acceptedInvitationCount: number;
    suspendedUserCount: number;
  };
  devices: {
    total: number;
    active: number;
    revoked: number;
    recentlySeen: number;
    activeAuthSessionCount: number;
    rows: AdminTeacherAppDeviceSupportRow[];
  };
};

export type AdminTeacherAppDeviceSupportRow = {
  id: string;
  label: string;
  status: TeacherAppDeviceStatus;
  statusLabel: string;
  revokeStateLabel: string;
  lastClientPlatform: TeacherAppClientPlatform | null;
  lastClientLabel: string;
  lastAuthenticatedAt: string | null;
  lastSeenAt: string | null;
  lastAppVersion: string | null;
  lastBuildNumber: string | null;
  registeredBy: {
    name: string;
    role: UserRole;
    roleLabel: string;
  };
  activeAuthSessionCount: number;
  revokedAuthSessionCount: number;
  createdAt: string;
  updatedAt: string;
};

export type GetAdminTeacherAppDeviceSupportOptions = {
  operator?: PlatformOperatorContext | null;
  organizationId: string;
  now?: Date;
};

const RECENTLY_SEEN_DAYS = 14;

function toIsoString(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function roleLabel(role: UserRole | string) {
  if (role === "ADMIN") return "管理者";
  if (role === "MANAGER") return "室長";
  if (role === "TEACHER") return "講師";
  if (role === "INSTRUCTOR") return "講師";
  return String(role);
}

function deviceStatusLabel(status: TeacherAppDeviceStatus) {
  if (status === TeacherAppDeviceStatus.ACTIVE) return "有効";
  if (status === TeacherAppDeviceStatus.REVOKED) return "停止済み";
  return status;
}

function revokeStateLabel(input: {
  status: TeacherAppDeviceStatus;
  activeAuthSessionCount: number;
  revokedAuthSessionCount: number;
}) {
  if (input.status === TeacherAppDeviceStatus.REVOKED) return "端末停止済み";
  if (input.revokedAuthSessionCount > 0 && input.activeAuthSessionCount > 0) return "一部セッション停止済み";
  if (input.revokedAuthSessionCount > 0) return "過去セッション停止あり";
  return "停止なし";
}

function clientLabel(platform: TeacherAppClientPlatform | null, version: string | null, buildNumber: string | null) {
  const platformLabel =
    platform === "IOS"
      ? "iOS"
      : platform === "ANDROID"
        ? "Android"
        : platform === "WEB"
          ? "Web"
          : "不明";
  const versionLabel = version ? `v${version}` : null;
  const buildLabel = buildNumber ? `build ${buildNumber}` : null;
  return [platformLabel, versionLabel, buildLabel].filter(Boolean).join(" / ");
}

export async function getAdminTeacherAppDeviceSupportSnapshot(
  options: GetAdminTeacherAppDeviceSupportOptions
): Promise<AdminTeacherAppDeviceSupportSnapshot | null> {
  if (options.operator !== undefined) assertPlatformAdminReadable(options.operator);

  const now = options.now ?? new Date();
  const recentlySeenCutoff = new Date(now.getTime() - RECENTLY_SEEN_DAYS * 24 * 60 * 60 * 1000);

  const organization = await prisma.organization.findUnique({
    where: { id: options.organizationId },
    select: {
      id: true,
      name: true,
      planCode: true,
    },
  });

  if (!organization) return null;

  const [userRoleCounts, pendingInvitationCount, expiredInvitationCount, acceptedInvitationCount, devices] = await Promise.all([
    prisma.user.groupBy({
      by: ["role"],
      where: { organizationId: options.organizationId },
      _count: { _all: true },
    }),
    prisma.organizationInvitation.count({
      where: { organizationId: options.organizationId, acceptedAt: null, expiresAt: { gt: now } },
    }),
    prisma.organizationInvitation.count({
      where: { organizationId: options.organizationId, acceptedAt: null, expiresAt: { lte: now } },
    }),
    prisma.organizationInvitation.count({
      where: { organizationId: options.organizationId, acceptedAt: { not: null } },
    }),
    prisma.teacherAppDevice.findMany({
      where: { organizationId: options.organizationId },
      orderBy: [{ status: "asc" }, { lastSeenAt: "desc" }, { updatedAt: "desc" }],
      take: 100,
      select: {
        id: true,
        label: true,
        status: true,
        lastClientPlatform: true,
        lastAppVersion: true,
        lastBuildNumber: true,
        lastAuthenticatedAt: true,
        lastSeenAt: true,
        createdAt: true,
        updatedAt: true,
        configuredBy: {
          select: {
            name: true,
            role: true,
          },
        },
        _count: {
          select: {
            authSessions: {
              where: { status: TeacherAppDeviceAuthSessionStatus.ACTIVE },
            },
          },
        },
      },
    }),
  ]);

  const revokedSessionCounts = devices.length
    ? await prisma.teacherAppDeviceAuthSession.groupBy({
        by: ["deviceId"],
        where: {
          organizationId: options.organizationId,
          deviceId: { in: devices.map((device) => device.id) },
          status: TeacherAppDeviceAuthSessionStatus.REVOKED,
        },
        _count: { _all: true },
      })
    : [];
  const revokedSessionCountByDeviceId = new Map(
    revokedSessionCounts.map((row) => [row.deviceId, row._count._all])
  );
  const byRole = Object.fromEntries(userRoleCounts.map((row) => [row.role, row._count._all]));
  const userTotal = userRoleCounts.reduce((sum, row) => sum + row._count._all, 0);

  const rows = devices.map((device) => {
    const activeAuthSessionCount = device._count.authSessions;
    const revokedAuthSessionCount = revokedSessionCountByDeviceId.get(device.id) ?? 0;
    return {
      id: device.id,
      label: device.label,
      status: device.status,
      statusLabel: deviceStatusLabel(device.status),
      revokeStateLabel: revokeStateLabel({
        status: device.status,
        activeAuthSessionCount,
        revokedAuthSessionCount,
      }),
      lastClientPlatform: device.lastClientPlatform ?? null,
      lastClientLabel: clientLabel(
        device.lastClientPlatform ?? null,
        device.lastAppVersion ?? null,
        device.lastBuildNumber ?? null
      ),
      lastAuthenticatedAt: toIsoString(device.lastAuthenticatedAt),
      lastSeenAt: toIsoString(device.lastSeenAt),
      lastAppVersion: device.lastAppVersion ?? null,
      lastBuildNumber: device.lastBuildNumber ?? null,
      registeredBy: {
        name: device.configuredBy.name,
        role: device.configuredBy.role,
        roleLabel: roleLabel(device.configuredBy.role),
      },
      activeAuthSessionCount,
      revokedAuthSessionCount,
      createdAt: device.createdAt.toISOString(),
      updatedAt: device.updatedAt.toISOString(),
    } satisfies AdminTeacherAppDeviceSupportRow;
  });

  const active = rows.filter((device) => device.status === TeacherAppDeviceStatus.ACTIVE).length;
  const revoked = rows.filter((device) => device.status === TeacherAppDeviceStatus.REVOKED).length;

  return {
    generatedAt: now.toISOString(),
    campus: {
      id: organization.id,
      name: organization.name,
      planCode: organization.planCode,
    },
    users: {
      total: userTotal,
      byRole,
      pendingInvitationCount,
      expiredInvitationCount,
      acceptedInvitationCount,
      suspendedUserCount: 0,
    },
    devices: {
      total: rows.length,
      active,
      revoked,
      recentlySeen: rows.filter((device) => {
        if (!device.lastSeenAt) return false;
        return new Date(device.lastSeenAt).getTime() >= recentlySeenCutoff.getTime();
      }).length,
      activeAuthSessionCount: rows.reduce((sum, device) => sum + device.activeAuthSessionCount, 0),
      rows,
    },
  };
}
