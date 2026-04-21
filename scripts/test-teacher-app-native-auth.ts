import assert from "node:assert/strict";
import {
  createTeacherAppAccessToken,
  createTeacherAppDeviceSession,
  createTeacherAppRefreshToken,
  getTeacherAppAccessTokenTtlMs,
  hashTeacherAppRefreshToken,
  parseTeacherAppAccessToken,
} from "@/lib/teacher-app/device-auth";

async function main() {
  process.env.AUTH_SECRET ??= "teacher-native-auth-test-secret";

  const issuedAt = new Date();
  const session = createTeacherAppDeviceSession(
    {
      id: "user_native_123",
      email: "native-admin@example.com",
      name: "Native Admin",
      role: "ADMIN",
      organizationId: "org_native_123",
    },
    {
      id: "device_native_123",
      label: "渋谷校 iPhone 16",
    },
    {
      issuedAt,
      ttlMs: getTeacherAppAccessTokenTtlMs(),
    }
  );

  const accessToken = createTeacherAppAccessToken({
    authSessionId: "auth_session_123",
    session,
  });
  const parsedAccess = parseTeacherAppAccessToken(accessToken);
  assert.ok(parsedAccess);
  assert.equal(parsedAccess.authSessionId, "auth_session_123");
  assert.equal(parsedAccess.session.deviceId, "device_native_123");
  assert.equal(parsedAccess.session.organizationId, "org_native_123");
  assert.equal(parsedAccess.session.expiresAt, session.expiresAt);

  const refreshToken = createTeacherAppRefreshToken();
  const otherRefreshToken = createTeacherAppRefreshToken();
  assert.notEqual(refreshToken, otherRefreshToken);
  assert.equal(hashTeacherAppRefreshToken(refreshToken), hashTeacherAppRefreshToken(refreshToken));
  assert.notEqual(hashTeacherAppRefreshToken(refreshToken), hashTeacherAppRefreshToken(otherRefreshToken));

  console.log("teacher app native auth checks passed");
}

void main();
