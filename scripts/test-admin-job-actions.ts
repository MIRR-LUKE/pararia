#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(path, "utf8");
}

const route = read("app/api/admin/operations/jobs/[kind]/[id]/route.ts");
const page = read("app/admin/campuses/[organizationId]/operations/page.tsx");
const client = read("app/admin/campuses/[organizationId]/operations/AdminCampusOperationsClient.tsx");
const audit = read("lib/admin/platform-audit.ts");
const campusDetail = read("app/admin/campuses/[organizationId]/page.tsx");

assert.ok(route.includes("resolvePlatformOperatorForSession"), "admin job action route must require PlatformOperator");
assert.ok(route.includes("canExecuteDangerousActions"), "admin job action route must require dangerous action permission");
assert.ok(route.includes("writePlatformAuditLog"), "admin job action route must write PlatformAuditLog");
assert.ok(route.includes('status: "PREPARED"'), "admin job action route must audit prepared action");
assert.ok(route.includes('status: "SUCCESS"'), "admin job action route must audit success");
assert.ok(route.includes('status: "ERROR"'), "admin job action route must audit errors");
assert.ok(route.includes('status: "DENIED"'), "admin job action route must audit denied attempts");
assert.ok(route.includes("reason"), "admin job action route must require and persist a reason");
assert.ok(route.includes("confirmJobId"), "admin job action route must require explicit target confirmation");
assert.ok(route.includes("Idempotency-Key"), "admin job action route must accept idempotency key");
assert.equal(route.includes("writeAuditLog"), false, "admin job action route must not use tenant audit log");
assert.equal(route.includes("requireAuthorizedMutationSession"), false, "admin job action route must not use tenant mutation auth");

assert.ok(page.includes("getAdminOperationsSnapshot"), "operations page must load the existing operations snapshot");
assert.ok(page.includes("canExecuteDangerousActions"), "operations page must pass dangerous action permission to UI");
assert.ok(client.includes("操作理由"), "operations UI must ask for an operation reason");
assert.ok(client.includes("確認のためジョブIDを入力"), "operations UI must ask for target confirmation");
assert.ok(client.includes("/api/admin/operations/jobs/"), "operations UI must call admin action route");
assert.equal(client.includes("window.prompt"), false, "operations UI must not use prompt for dangerous actions");
assert.ok(audit.includes("reasonRequired: true"), "platform audit draft must mark reasons as required");
assert.ok(campusDetail.includes("/operations"), "campus detail must link to operations page");

console.log("admin job action checks passed");
