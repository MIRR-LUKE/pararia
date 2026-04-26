#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(path, "utf8");
}

const supportLib = read("lib/admin/platform-device-support.ts");
const devicesApi = read("app/api/admin/campuses/[organizationId]/devices/route.ts");
const devicesPage = read("app/admin/campuses/[organizationId]/devices/page.tsx");

assert.ok(
  supportLib.includes("assertPlatformAdminReadable"),
  "device support snapshot must enforce PlatformOperator read access"
);
assert.ok(
  devicesApi.includes("resolvePlatformOperatorForSession"),
  "device support API must resolve PlatformOperator access"
);
assert.ok(
  devicesApi.includes("!operator?.permissions.canReadAllCampuses"),
  "device support API must reject tenant admins without PlatformOperator access"
);
assert.equal(devicesApi.includes("export async function POST"), false, "device support API must stay confirmation-only");
assert.equal(devicesApi.includes("export async function PATCH"), false, "device support API must stay confirmation-only");
assert.equal(devicesApi.includes("export async function DELETE"), false, "device support API must stay confirmation-only");

assert.ok(supportLib.includes("teacherAppDevice.findMany"), "device support must read Teacher App devices");
assert.ok(supportLib.includes("TeacherAppDeviceAuthSessionStatus.ACTIVE"), "device support must count active auth sessions");
assert.ok(supportLib.includes("TeacherAppDeviceAuthSessionStatus.REVOKED"), "device support must show revoke state");
assert.ok(supportLib.includes("pushNotificationPermission"), "device support must expose push notification state");
assert.ok(supportLib.includes("lastPushSentAt"), "device support must expose last push send state");
assert.ok(supportLib.includes("organizationInvitation.count"), "device support must summarize invitations with bounded counts");
assert.equal(supportLib.includes("organizationInvitation.findMany"), false, "device support must not fetch every invitation row");
assert.ok(supportLib.includes("byRole"), "device support must summarize user roles");

assert.equal(supportLib.includes("refreshTokenHash: true"), false, "refresh token hashes must not be selected");
assert.equal(supportLib.includes("email: true"), false, "device support must not select user or invitation emails");
assert.equal(devicesPage.includes("session.user.email ??"), false, "device support page must not render email fallbacks");
assert.equal(devicesApi.includes("session.user.organizationId"), false, "device support API must not scope to caller campus");

assert.equal(devicesPage.includes("onClick"), false, "device support page must not expose action buttons");
assert.equal(devicesPage.includes("端末を停止"), false, "device support page must not expose revoke controls");
assert.ok(devicesPage.includes("確認専用"), "device support page must communicate confirmation-only support");
assert.ok(devicesPage.includes("通知"), "device support page must render push notification state");

console.log("admin device support regression checks passed");
