#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { canOperateProductionJobs, canRunMaintenanceRoutes } from "../lib/permissions";

const originalAllowlist = process.env.PARARIA_ADMIN_OPERATOR_EMAILS;

try {
  delete process.env.PARARIA_ADMIN_OPERATOR_EMAILS;
  assert.equal(canOperateProductionJobs("ADMIN", "client-admin@example.com"), false);
  assert.equal(canRunMaintenanceRoutes("ADMIN", "client-admin@example.com"), false);
  assert.equal(canOperateProductionJobs("MANAGER", "ops@example.com"), false);

  process.env.PARARIA_ADMIN_OPERATOR_EMAILS = "ops@example.com, second@example.com";
  assert.equal(canOperateProductionJobs("ADMIN", "ops@example.com"), true);
  assert.equal(canOperateProductionJobs("ADMIN", "OPS@example.com"), true);
  assert.equal(canOperateProductionJobs("ADMIN", "client-admin@example.com"), false);
  assert.equal(canRunMaintenanceRoutes("ADMIN", "second@example.com"), true);
  assert.equal(canRunMaintenanceRoutes("MANAGER", "ops@example.com"), false);
} finally {
  if (originalAllowlist === undefined) {
    delete process.env.PARARIA_ADMIN_OPERATOR_EMAILS;
  } else {
    process.env.PARARIA_ADMIN_OPERATOR_EMAILS = originalAllowlist;
  }
}

console.log("admin operator permission regression checks passed");
