#!/usr/bin/env tsx

import assert from "node:assert/strict";
import {
  TeacherAppClientPlatform,
  TeacherAppDeviceAuthSessionStatus,
  TeacherAppDeviceStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { revokeTeacherAppDevice } from "@/lib/teacher-app/device-registry";
import {
  loadActiveTeacherAppNativeAuthContext,
  rotateTeacherAppNativeAuthSession,
} from "@/lib/teacher-app/server/native-auth-sessions";

function buildAuthSessionRecord(deviceStatus: TeacherAppDeviceStatus) {
  return {
    id: "auth-session-1",
    organizationId: "org-1",
    status: TeacherAppDeviceAuthSessionStatus.ACTIVE,
    clientPlatform: TeacherAppClientPlatform.ANDROID,
    appVersion: "1.2.3",
    buildNumber: "45",
    refreshTokenExpiresAt: new Date(Date.now() + 60_000),
    device: {
      id: "device-1",
      label: "校舎 Android",
      organizationId: "org-1",
      status: deviceStatus,
    },
    user: {
      id: "user-1",
      email: "admin@example.com",
      name: "Admin",
      organizationId: "org-1",
      role: "ADMIN",
    },
  };
}

async function main() {
  process.env.AUTH_SECRET ??= "teacher-app-device-revoke-test-secret";

  const originalTransaction = prisma.$transaction.bind(prisma);
  const originalFindFirst = prisma.teacherAppDeviceAuthSession.findFirst.bind(prisma.teacherAppDeviceAuthSession);
  const originalFindUnique = prisma.teacherAppDeviceAuthSession.findUnique.bind(prisma.teacherAppDeviceAuthSession);

  try {
    let authSessionUpdateManyCalled = false;
    let deviceUpdateCalled = false;
    const tx = {
      teacherAppDevice: {
        findFirst: async () => ({
          id: "device-1",
          organizationId: "org-1",
          label: "校舎 Android",
          status: TeacherAppDeviceStatus.ACTIVE,
        }),
        update: async ({ data }: any) => {
          deviceUpdateCalled = true;
          assert.equal(data.status, TeacherAppDeviceStatus.REVOKED);
          return {
            id: "device-1",
            organizationId: "org-1",
            label: "校舎 Android",
            status: TeacherAppDeviceStatus.REVOKED,
            updatedAt: new Date("2026-04-25T00:00:00.000Z"),
          };
        },
      },
      teacherAppDeviceAuthSession: {
        updateMany: async ({ data }: any) => {
          authSessionUpdateManyCalled = true;
          assert.equal(data.status, TeacherAppDeviceAuthSessionStatus.REVOKED);
          assert.equal(data.revokeReason, "lost tablet");
          assert.ok(data.revokedAt instanceof Date);
          return { count: 2 };
        },
      },
    };

    (prisma.$transaction as any) = async (callback: any) => callback(tx);

    const revoked = await revokeTeacherAppDevice({
      deviceId: "device-1",
      organizationId: "org-1",
      confirmLabel: "校舎 Android",
      reason: "lost tablet",
    });
    assert.equal(revoked.ok, true);
    assert.equal(revoked.revokedAuthSessionCount, 2);
    assert.equal(authSessionUpdateManyCalled, true);
    assert.equal(deviceUpdateCalled, true);

    const mismatch = await revokeTeacherAppDevice({
      deviceId: "device-1",
      organizationId: "org-1",
      confirmLabel: "別端末",
      reason: "wrong label",
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.code, "confirmation_mismatch");

    (prisma.teacherAppDeviceAuthSession.findFirst as any) = async () =>
      buildAuthSessionRecord(TeacherAppDeviceStatus.REVOKED);
    const revokedContext = await loadActiveTeacherAppNativeAuthContext({
      authSessionId: "auth-session-1",
      organizationId: "org-1",
    });
    assert.equal(revokedContext, null, "revoked devices should not load native auth sessions");

    (prisma.teacherAppDeviceAuthSession.findUnique as any) = async () =>
      buildAuthSessionRecord(TeacherAppDeviceStatus.REVOKED);
    const refreshed = await rotateTeacherAppNativeAuthSession({
      refreshToken: "refresh-token-value",
    });
    assert.equal(refreshed, null, "revoked devices should not rotate refresh tokens");

    console.log("teacher app device revoke checks passed");
  } finally {
    (prisma.$transaction as any) = originalTransaction;
    (prisma.teacherAppDeviceAuthSession.findFirst as any) = originalFindFirst;
    (prisma.teacherAppDeviceAuthSession.findUnique as any) = originalFindUnique;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
