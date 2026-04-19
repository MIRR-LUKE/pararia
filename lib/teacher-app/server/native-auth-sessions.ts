import {
  TeacherAppClientPlatform,
  TeacherAppDeviceAuthSessionStatus,
  TeacherAppDeviceStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import {
  createTeacherAppAccessToken,
  createTeacherAppDeviceSession,
  createTeacherAppRefreshToken,
  getTeacherAppAccessTokenTtlMs,
  getTeacherAppRefreshTokenTtlMs,
  hashTeacherAppRefreshToken,
} from "@/lib/teacher-app/device-auth";
import { touchTeacherAppDeviceNativeClientState } from "@/lib/teacher-app/device-registry";
import type {
  TeacherAppClientInfo,
  TeacherAppClientPlatform as TeacherAppClientPlatformValue,
  TeacherAppNativeAuthResponse,
} from "@/lib/teacher-app/types";

type AuthSessionRecord = Awaited<ReturnType<typeof loadTeacherAppDeviceAuthSessionById>>;

function toPrismaPlatform(platform: TeacherAppClientPlatformValue): TeacherAppClientPlatform {
  switch (platform) {
    case "IOS":
      return TeacherAppClientPlatform.IOS;
    case "ANDROID":
      return TeacherAppClientPlatform.ANDROID;
    case "WEB":
      return TeacherAppClientPlatform.WEB;
    default:
      return TeacherAppClientPlatform.UNKNOWN;
  }
}

function fromPrismaPlatform(platform: TeacherAppClientPlatform | null | undefined): TeacherAppClientPlatformValue {
  switch (platform) {
    case TeacherAppClientPlatform.IOS:
      return "IOS";
    case TeacherAppClientPlatform.ANDROID:
      return "ANDROID";
    case TeacherAppClientPlatform.WEB:
      return "WEB";
    default:
      return "UNKNOWN";
  }
}

function toClientInfo(input: {
  clientPlatform?: TeacherAppClientPlatform | null;
  appVersion?: string | null;
  buildNumber?: string | null;
}): TeacherAppClientInfo {
  return {
    platform: fromPrismaPlatform(input.clientPlatform),
    appVersion: input.appVersion ?? null,
    buildNumber: input.buildNumber ?? null,
  };
}

function buildNativeAuthResponse(input: {
  authSessionId: string;
  client: TeacherAppClientInfo;
  issuedAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  device: {
    id: string;
    label: string;
  };
  user: SessionUser;
}): TeacherAppNativeAuthResponse {
  const session = createTeacherAppDeviceSession(
    {
      id: input.user.id,
      email: input.user.email,
      name: input.user.name,
      organizationId: input.user.organizationId,
      role: input.user.role,
    },
    input.device,
    {
      issuedAt: input.issuedAt,
      ttlMs: getTeacherAppAccessTokenTtlMs(),
    }
  );

  return {
    session,
    client: input.client,
    auth: {
      accessToken: createTeacherAppAccessToken({
        authSessionId: input.authSessionId,
        session,
      }),
      accessTokenExpiresAt: session.expiresAt,
      refreshToken: input.refreshToken,
      refreshTokenExpiresAt: input.refreshTokenExpiresAt.toISOString(),
      authSessionId: input.authSessionId,
      tokenType: "Bearer",
    },
  };
}

async function revokeActiveSessionsForDevice(input: { deviceId: string; organizationId: string; reason: string }) {
  await prisma.teacherAppDeviceAuthSession.updateMany({
    where: {
      deviceId: input.deviceId,
      organizationId: input.organizationId,
      status: TeacherAppDeviceAuthSessionStatus.ACTIVE,
    },
    data: {
      status: TeacherAppDeviceAuthSessionStatus.REVOKED,
      revokedAt: new Date(),
      revokeReason: input.reason,
    },
  });
}

export async function issueTeacherAppNativeAuthSession(input: {
  client: TeacherAppClientInfo;
  device: {
    id: string;
    label: string;
    organizationId: string;
  };
  user: SessionUser;
}) {
  const issuedAt = new Date();
  const refreshToken = createTeacherAppRefreshToken();
  const refreshTokenExpiresAt = new Date(issuedAt.getTime() + getTeacherAppRefreshTokenTtlMs());

  await revokeActiveSessionsForDevice({
    deviceId: input.device.id,
    organizationId: input.device.organizationId,
    reason: "rotated_on_login",
  });

  const authSession = await prisma.teacherAppDeviceAuthSession.create({
    data: {
      organizationId: input.device.organizationId,
      userId: input.user.id,
      deviceId: input.device.id,
      status: TeacherAppDeviceAuthSessionStatus.ACTIVE,
      clientPlatform: toPrismaPlatform(input.client.platform),
      appVersion: input.client.appVersion,
      buildNumber: input.client.buildNumber,
      refreshTokenHash: hashTeacherAppRefreshToken(refreshToken),
      refreshTokenExpiresAt,
      lastSeenAt: issuedAt,
      lastRefreshedAt: issuedAt,
    },
    select: {
      id: true,
    },
  });

  await touchTeacherAppDeviceNativeClientState({
    deviceId: input.device.id,
    organizationId: input.device.organizationId,
    clientPlatform: toPrismaPlatform(input.client.platform),
    appVersion: input.client.appVersion,
    buildNumber: input.client.buildNumber,
    authenticatedAt: issuedAt,
  });

  return buildNativeAuthResponse({
    authSessionId: authSession.id,
    client: input.client,
    issuedAt,
    refreshToken,
    refreshTokenExpiresAt,
    device: input.device,
    user: input.user,
  });
}

async function loadTeacherAppDeviceAuthSessionByRefreshTokenHash(refreshTokenHash: string) {
  return prisma.teacherAppDeviceAuthSession.findUnique({
    where: {
      refreshTokenHash,
    },
    select: {
      id: true,
      organizationId: true,
      status: true,
      clientPlatform: true,
      appVersion: true,
      buildNumber: true,
      refreshTokenExpiresAt: true,
      device: {
        select: {
          id: true,
          label: true,
          organizationId: true,
          status: true,
        },
      },
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          organizationId: true,
          role: true,
        },
      },
    },
  });
}

async function loadTeacherAppDeviceAuthSessionById(input: { authSessionId: string; organizationId: string }) {
  return prisma.teacherAppDeviceAuthSession.findFirst({
    where: {
      id: input.authSessionId,
      organizationId: input.organizationId,
    },
    select: {
      id: true,
      organizationId: true,
      status: true,
      clientPlatform: true,
      appVersion: true,
      buildNumber: true,
      refreshTokenExpiresAt: true,
      device: {
        select: {
          id: true,
          label: true,
          organizationId: true,
          status: true,
        },
      },
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          organizationId: true,
          role: true,
        },
      },
    },
  });
}

function isActiveAuthSessionRecord(record: AuthSessionRecord): record is NonNullable<AuthSessionRecord> {
  if (!record) return false;
  if (record.status !== TeacherAppDeviceAuthSessionStatus.ACTIVE) return false;
  if (record.device.status !== TeacherAppDeviceStatus.ACTIVE) return false;
  return record.refreshTokenExpiresAt.getTime() > Date.now();
}

export async function rotateTeacherAppNativeAuthSession(input: {
  refreshToken: string;
  client?: TeacherAppClientInfo | null;
}) {
  const refreshTokenHash = hashTeacherAppRefreshToken(input.refreshToken);
  const record = await loadTeacherAppDeviceAuthSessionByRefreshTokenHash(refreshTokenHash);
  if (!isActiveAuthSessionRecord(record)) {
    return null;
  }

  const issuedAt = new Date();
  const refreshToken = createTeacherAppRefreshToken();
  const refreshTokenExpiresAt = new Date(issuedAt.getTime() + getTeacherAppRefreshTokenTtlMs());
  const client = input.client ?? toClientInfo(record);

  await prisma.teacherAppDeviceAuthSession.update({
    where: {
      id: record.id,
    },
    data: {
      clientPlatform: toPrismaPlatform(client.platform),
      appVersion: client.appVersion,
      buildNumber: client.buildNumber,
      refreshTokenHash: hashTeacherAppRefreshToken(refreshToken),
      refreshTokenExpiresAt,
      lastSeenAt: issuedAt,
      lastRefreshedAt: issuedAt,
    },
  });

  await touchTeacherAppDeviceNativeClientState({
    deviceId: record.device.id,
    organizationId: record.organizationId,
    clientPlatform: toPrismaPlatform(client.platform),
    appVersion: client.appVersion,
    buildNumber: client.buildNumber,
    authenticatedAt: issuedAt,
  });

  return buildNativeAuthResponse({
    authSessionId: record.id,
    client,
    issuedAt,
    refreshToken,
    refreshTokenExpiresAt,
    device: record.device,
    user: record.user,
  });
}

export async function loadActiveTeacherAppNativeAuthContext(input: { authSessionId: string; organizationId: string }) {
  const record = await loadTeacherAppDeviceAuthSessionById(input);
  if (!isActiveAuthSessionRecord(record)) {
    return null;
  }
  return {
    authSessionId: record.id,
    client: toClientInfo(record),
    device: record.device,
    user: record.user,
  };
}

export async function revokeTeacherAppNativeAuthSession(input: {
  authSessionId: string;
  organizationId: string;
  reason: string;
}) {
  await prisma.teacherAppDeviceAuthSession.updateMany({
    where: {
      id: input.authSessionId,
      organizationId: input.organizationId,
      status: TeacherAppDeviceAuthSessionStatus.ACTIVE,
    },
    data: {
      status: TeacherAppDeviceAuthSessionStatus.REVOKED,
      revokedAt: new Date(),
      revokeReason: input.reason,
    },
  });
}

export async function touchTeacherAppNativeAuthSessionLastSeen(input: {
  authSessionId: string;
  organizationId: string;
}) {
  await prisma.teacherAppDeviceAuthSession.updateMany({
    where: {
      id: input.authSessionId,
      organizationId: input.organizationId,
      status: TeacherAppDeviceAuthSessionStatus.ACTIVE,
    },
    data: {
      lastSeenAt: new Date(),
    },
  });
}
