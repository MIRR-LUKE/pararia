#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function read(path: string) {
  assert.ok(existsSync(path), `${path} must exist`);
  return readFileSync(path, "utf8");
}

const auditLib = read("lib/admin/platform-audit-search.ts");
const auditPage = read("app/admin/audit/page.tsx");
const auditApi = read("app/api/admin/audit/route.ts");
const exportApi = read("app/api/admin/audit/export/route.ts");

assert.ok(auditLib.includes("searchPlatformAuditLogs"), "audit search helper must be implemented");
assert.ok(auditLib.includes("DEFAULT_SEARCH_TAKE = 20"), "initial audit search must default to 20 rows");
assert.ok(auditLib.includes("defaultImportantOnly"), "initial audit search must be important-only");
assert.ok(auditLib.includes("actorOperator:") && auditLib.includes("email: true"), "audit search may expose operator email only through explicit select");
assert.equal(auditLib.includes("requestIpHash: true"), false, "audit API must not expose request IP hashes");
assert.equal(auditLib.includes("userAgentHash: true"), false, "audit API must not expose user agent hashes");
assert.equal(auditLib.includes("beforeJson: true"), false, "audit API must not expose beforeJson in the search response");
assert.equal(auditLib.includes("afterJson: true"), false, "audit API must not expose afterJson in the search response");

assert.ok(auditPage.includes("resolvePlatformOperatorForSession"), "/admin/audit must resolve PlatformOperator access");
assert.ok(auditPage.includes("canReadAuditLogs"), "/admin/audit must require audit log permission");
assert.ok(auditPage.includes("読み取り専用"), "/admin/audit must present a read-only Japanese UI");
assert.ok(auditPage.includes("初期表示は最近の重要操作20件"), "/admin/audit must explain the limited initial view");
assert.ok(auditPage.includes("from") && auditPage.includes("to"), "/admin/audit must support period filters");
assert.ok(auditPage.includes("operator"), "/admin/audit must support operator filter");
assert.ok(auditPage.includes("campus"), "/admin/audit must support campus filter");
assert.ok(auditPage.includes("action"), "/admin/audit must support action filter");
assert.ok(auditPage.includes("status"), "/admin/audit must support status filter");

assert.ok(auditApi.includes("requireAuthorizedSession"), "/api/admin/audit must require an authorized session");
assert.ok(auditApi.includes("resolvePlatformOperatorForSession"), "/api/admin/audit must use PlatformOperator access");
assert.ok(auditApi.includes("canReadAuditLogs"), "/api/admin/audit must require audit log permission");
assert.ok(auditApi.includes("searchPlatformAuditLogs"), "/api/admin/audit must call the safe search helper");

assert.ok(exportApi.includes("requireAuthorizedSession"), "audit export must require an authorized session");
assert.ok(exportApi.includes("resolvePlatformOperatorForSession"), "audit export must use PlatformOperator access");
assert.ok(exportApi.includes("canReadAuditLogs"), "audit export must require audit log permission");
assert.ok(exportApi.includes("exportPlatformAuditLogs"), "audit export must call the audited export helper");
assert.ok(auditLib.includes("writePlatformAuditLog"), "audit export helper must record export in PlatformAuditLog");
assert.ok(auditLib.includes("platform_audit_export"), "audit export action must have a stable audit action name");
assert.ok(exportApi.includes("text/csv") && exportApi.includes("application/json"), "audit export must support CSV and JSON");

console.log("admin audit search/export regression checks passed");
