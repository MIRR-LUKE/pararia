#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { collectViolations, isRelevantBranch } from "./check-backend-branch-scope";

assert.equal(isRelevantBranch("backend/lock-guard"), true);
assert.equal(isRelevantBranch("perf/student-room"), true);
assert.equal(isRelevantBranch("feature/pararia-performance-phase1"), true);
assert.equal(isRelevantBranch("feature/student-edit"), false);

const violations = collectViolations([
  "app/api/students/route.ts",
  "app/app/students/page.tsx",
  "components/ui/Button.tsx",
  "public/logo.png",
  "styles/admin.css",
  "tailwind.config.ts",
  "lib/session-progress.ts",
]);

assert.deepEqual(
  violations.map((violation) => violation.path),
  [
    "app/app/students/page.tsx",
    "components/ui/Button.tsx",
    "public/logo.png",
    "styles/admin.css",
    "tailwind.config.ts",
  ]
);
assert.match(violations[0]?.reason ?? "", /app\/\*\*/);
assert.match(violations[1]?.reason ?? "", /components\/\*\*/);
assert.match(violations[2]?.reason ?? "", /public\/\*\*/);
assert.match(violations[3]?.reason ?? "", /styles\/\*\*/);
assert.match(violations[4]?.reason ?? "", /tailwind\/postcss config/);

console.log("backend-scope-guard regression checks passed");
