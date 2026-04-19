import assert from "node:assert/strict";
import {
  createTeacherAppDeviceSession,
  parseTeacherAppSessionToken,
  serializeTeacherAppSessionToken,
} from "@/lib/teacher-app/device-auth";

async function main() {
  process.env.AUTH_SECRET ??= "teacher-app-test-secret";

  const session = createTeacherAppDeviceSession(
    {
      id: "user_123",
      email: "admin@example.com",
      name: "校舎 管理者",
      role: "ADMIN",
      organizationId: "org_123",
    },
    "渋谷校 iPhone"
  );

  const token = serializeTeacherAppSessionToken(session);
  const parsed = parseTeacherAppSessionToken(token);
  assert.ok(parsed);
  assert.equal(parsed.userId, session.userId);
  assert.equal(parsed.organizationId, session.organizationId);
  assert.equal(parsed.deviceLabel, "渋谷校 iPhone");

  const tampered = token.replace("i", "j");
  assert.equal(parseTeacherAppSessionToken(tampered), null);

  console.log("teacher app device auth checks passed");
}

void main();
