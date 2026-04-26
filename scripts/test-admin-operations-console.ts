#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(path, "utf8");
}

const settingsClient = read("app/app/settings/SettingsPageClient.tsx");
const settingsSections = read("app/app/settings/SettingsPageSections.tsx");
const settingsController = read("app/app/settings/useSettingsPageController.ts");
const adminPage = read("app/admin/page.tsx");
const adminClient = read("app/admin/AdminPlatformPageClient.tsx");
const adminApi = read("app/api/admin/platform/route.ts");
const campusApi = read("app/api/admin/campuses/[organizationId]/route.ts");
const operationsApi = read("app/api/admin/operations/route.ts");
const platformOperators = read("lib/admin/platform-operators.ts");
const platformSnapshot = read("lib/admin/platform-admin-snapshot.ts");
const permissions = read("lib/permissions.ts");
const proxy = read("proxy.ts");
const readme = read("README.md");

assert.equal(
  settingsClient.includes("SettingsOperationsSection"),
  false,
  "/app/settings must not render the platform operations console"
);
assert.equal(
  settingsSections.includes("保守コンソール"),
  false,
  "/app/settings sections must not describe the platform operations console"
);
assert.equal(
  settingsController.includes("/api/operations/runpod"),
  false,
  "/app/settings controller must not call operations APIs"
);
assert.equal(
  settingsController.includes("/api/jobs/run"),
  false,
  "/app/settings controller must not run maintenance jobs"
);

assert.ok(adminPage.includes("resolvePlatformOperatorForSession"), "/admin must use PlatformOperator access");
assert.equal(adminPage.includes("getAdminOperationsSnapshot"), false, "/admin must not be the old per-campus console");
assert.ok(adminClient.includes("/api/admin/platform"), "/admin must refresh from the platform admin API");
assert.equal(adminClient.includes("/api/operations/jobs/"), false, "/admin home must not expose job retry/cancel controls");
assert.equal(adminClient.includes("/api/operations/runpod"), false, "/admin home must not expose infrastructure controls");
assert.ok(adminApi.includes("resolvePlatformOperatorForSession"), "/api/admin/platform must use PlatformOperator access");
assert.ok(campusApi.includes("resolvePlatformOperatorForSession"), "/api/admin/campuses must use PlatformOperator access");
assert.ok(operationsApi.includes("resolvePlatformOperatorForSession"), "/api/admin/operations must use PlatformOperator access");
assert.equal(
  operationsApi.includes("session.user.organizationId"),
  false,
  "/api/admin/operations must require an explicit target campus"
);
assert.ok(platformOperators.includes("prisma.platformOperator.findUnique"), "PlatformOperator DB record must be the primary admin source");
assert.ok(platformOperators.includes("lastSignedInAt"), "PlatformOperator sign-in should update lastSignedInAt");
assert.ok(platformSnapshot.includes("select:"), "admin snapshot must explicitly select safe fields");
assert.equal(platformSnapshot.includes("student: { select: { name"), false, "admin snapshot must not select student names");
assert.equal(platformSnapshot.includes("lastError"), false, "admin snapshot must not expose raw job errors in initial admin data");

assert.ok(proxy.includes("PARARIA_ADMIN_HOSTS"), "proxy must support admin subdomain host matching");
assert.ok(proxy.includes("PARARIA_ADMIN_BASE_URL"), "proxy must support redirecting /admin to admin subdomain");
assert.ok(proxy.includes("BASIC_AUTH_USER"), "proxy must preserve preview basic auth");
assert.ok(proxy.includes("isMaintenanceRoutePath"), "proxy must preserve maintenance route bypass");
assert.ok(permissions.includes("PARARIA_ADMIN_OPERATOR_EMAILS"), "emergency operator access must support email allowlist");
assert.equal(
  permissions.includes("if (!allowlist) return true"),
  false,
  "tenant ADMIN alone must not become a platform operator when allowlist is unset"
);

assert.ok(readme.includes("### 4.7 `/admin`"), "README must document the admin route");
assert.ok(readme.includes("管理者サブドメイン"), "README must explain the production subdomain recommendation");
assert.ok(readme.includes("PlatformOperator"), "README must explain PlatformOperator access");
assert.equal(
  readme.includes("管理者向けの保守コンソールから `jobs/run`"),
  false,
  "README must not place the operations console under /app/settings"
);

console.log("platform admin console regression checks passed");
