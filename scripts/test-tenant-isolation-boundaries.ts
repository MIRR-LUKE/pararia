#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnvFile } from "./lib/load-env-file";

type StaticCheck = {
  label: string;
  file: string;
  mustInclude: string[];
};

type DbCheck = {
  label: string;
  sql: string;
};

const root = process.cwd();

const staticChecks: StaticCheck[] = [
  {
    label: "authorized app session is corrected from live user organization",
    file: "lib/server/request-auth.ts",
    mustInclude: ["resolveAuthorizedSession", "organizationId", "prisma.user.findUnique"],
  },
  {
    label: "mutation session requires same-origin",
    file: "lib/server/request-auth.ts",
    mustInclude: ["requireAuthorizedMutationSession", "requireSameOriginRequest"],
  },
  {
    label: "same-origin checks origin and sec-fetch-site",
    file: "lib/server/request-security.ts",
    mustInclude: ["origin", "referer", "sec-fetch-site", "same-origin", "same-site"],
  },
  {
    label: "student collection is scoped by session organization and throttled",
    file: "app/api/students/route.ts",
    mustInclude: ["requireAuthorizedSession", "requireAuthorizedMutationSession", "applyLightMutationThrottle", "organizationId"],
  },
  {
    label: "student id route uses organization-scoped lookup",
    file: "app/api/students/[id]/route.ts",
    mustInclude: ["withActiveStudentWhere", "organizationId: authResult.session.user.organizationId", "applyLightMutationThrottle"],
  },
  {
    label: "conversation id route passes organizationId to service",
    file: "app/api/conversations/[id]/route.ts",
    mustInclude: ["requireAuthorizedSession", "requireAuthorizedMutationSession", "const organizationId = authResult.session.user.organizationId", "applyLightMutationThrottle"],
  },
  {
    label: "conversation service filters by organization and visibility",
    file: "app/api/conversations/[id]/route-service.ts",
    mustInclude: ["withVisibleConversationWhere({ id: conversationId, organizationId })", "writeAuditLog", "revalidateTag"],
  },
  {
    label: "report id route filters by organization and visibility",
    file: "app/api/reports/[id]/route.ts",
    mustInclude: ["withVisibleReportWhere({ id, organizationId })", "requireAuthorizedMutationSession", "applyLightMutationThrottle"],
  },
  {
    label: "settings update is role-gated and org-scoped",
    file: "app/api/settings/route.ts",
    mustInclude: ["canManageSettings", "session.user.organizationId", "applyLightMutationThrottle", "writeAuditLog"],
  },
  {
    label: "invitations are role-gated and org-scoped",
    file: "app/api/invitations/route.ts",
    mustInclude: ["canManageInvitations", "organizationId: session.user.organizationId", "applyLightMutationThrottle"],
  },
  {
    label: "teacher app session validates active device in organization",
    file: "lib/server/teacher-app-session.ts",
    mustInclude: ["loadActiveTeacherAppDevice", "loadActiveTeacherAppNativeAuthContext", "organizationId", "requireTeacherAppMutationSession"],
  },
  {
    label: "teacher recordings are org and device scoped",
    file: "lib/teacher-app/server/recording-confirm-service.ts",
    mustInclude: ["organizationId", "buildTeacherRecordingDeviceWhere", "selectedStudentId", "archivedAt: null"],
  },
  {
    label: "visibility helpers exclude soft-deleted content",
    file: "lib/content-visibility.ts",
    mustInclude: ["deletedAt: null"],
  },
  {
    label: "active student helper excludes archived students",
    file: "lib/students/student-lifecycle.ts",
    mustInclude: ["archivedAt: null", "organizationId"],
  },
  {
    label: "maintenance access is admin or secret only",
    file: "lib/server/request-auth.ts",
    mustInclude: ["requireMaintenanceAccess", "canRunMaintenanceRoutes", "maintenance_secret"],
  },
];

const dbChecks: DbCheck[] = [
  {
    label: "User rows reference an existing Organization",
    sql: `SELECT COUNT(*)::int AS count FROM "User" u LEFT JOIN "Organization" o ON o.id = u."organizationId" WHERE o.id IS NULL`,
  },
  {
    label: "Student rows reference an existing Organization",
    sql: `SELECT COUNT(*)::int AS count FROM "Student" s LEFT JOIN "Organization" o ON o.id = s."organizationId" WHERE o.id IS NULL`,
  },
  {
    label: "Session rows match their Student organization",
    sql: `SELECT COUNT(*)::int AS count FROM "Session" se JOIN "Student" st ON st.id = se."studentId" WHERE se."organizationId" <> st."organizationId"`,
  },
  {
    label: "Session rows match their User organization when userId is set",
    sql: `SELECT COUNT(*)::int AS count FROM "Session" se JOIN "User" u ON u.id = se."userId" WHERE se."userId" IS NOT NULL AND se."organizationId" <> u."organizationId"`,
  },
  {
    label: "SessionPart rows reference an existing Session",
    sql: `SELECT COUNT(*)::int AS count FROM "SessionPart" sp LEFT JOIN "Session" se ON se.id = sp."sessionId" WHERE se.id IS NULL`,
  },
  {
    label: "ConversationLog rows match their Student organization",
    sql: `SELECT COUNT(*)::int AS count FROM "ConversationLog" c JOIN "Student" st ON st.id = c."studentId" WHERE c."organizationId" <> st."organizationId"`,
  },
  {
    label: "ConversationLog rows match their User organization when userId is set",
    sql: `SELECT COUNT(*)::int AS count FROM "ConversationLog" c JOIN "User" u ON u.id = c."userId" WHERE c."userId" IS NOT NULL AND c."organizationId" <> u."organizationId"`,
  },
  {
    label: "ConversationLog rows match their Session organization when sessionId is set",
    sql: `SELECT COUNT(*)::int AS count FROM "ConversationLog" c JOIN "Session" se ON se.id = c."sessionId" WHERE c."sessionId" IS NOT NULL AND c."organizationId" <> se."organizationId"`,
  },
  {
    label: "ConversationJob rows reference an existing ConversationLog",
    sql: `SELECT COUNT(*)::int AS count FROM "ConversationJob" j LEFT JOIN "ConversationLog" c ON c.id = j."conversationId" WHERE c.id IS NULL`,
  },
  {
    label: "Report rows match their Student organization",
    sql: `SELECT COUNT(*)::int AS count FROM "Report" r JOIN "Student" st ON st.id = r."studentId" WHERE r."organizationId" <> st."organizationId"`,
  },
  {
    label: "Report rows match their sentBy User organization when sentByUserId is set",
    sql: `SELECT COUNT(*)::int AS count FROM "Report" r JOIN "User" u ON u.id = r."sentByUserId" WHERE r."sentByUserId" IS NOT NULL AND r."organizationId" <> u."organizationId"`,
  },
  {
    label: "ReportDeliveryEvent rows match their Report organization",
    sql: `SELECT COUNT(*)::int AS count FROM "ReportDeliveryEvent" e JOIN "Report" r ON r.id = e."reportId" WHERE e."organizationId" <> r."organizationId"`,
  },
  {
    label: "ReportDeliveryEvent rows match their Student organization",
    sql: `SELECT COUNT(*)::int AS count FROM "ReportDeliveryEvent" e JOIN "Student" st ON st.id = e."studentId" WHERE e."organizationId" <> st."organizationId"`,
  },
  {
    label: "StudentRecordingLock rows match their Student organization",
    sql: `SELECT COUNT(*)::int AS count FROM "StudentRecordingLock" l JOIN "Student" st ON st.id = l."studentId" WHERE l."organizationId" <> st."organizationId"`,
  },
  {
    label: "StudentRecordingLock rows match their lockedBy User organization",
    sql: `SELECT COUNT(*)::int AS count FROM "StudentRecordingLock" l JOIN "User" u ON u.id = l."lockedByUserId" WHERE l."organizationId" <> u."organizationId"`,
  },
  {
    label: "TeacherAppDevice rows match their configuring User organization",
    sql: `SELECT COUNT(*)::int AS count FROM "TeacherAppDevice" d JOIN "User" u ON u.id = d."configuredByUserId" WHERE d."organizationId" <> u."organizationId"`,
  },
  {
    label: "TeacherAppDeviceAuthSession rows match their Device organization",
    sql: `SELECT COUNT(*)::int AS count FROM "TeacherAppDeviceAuthSession" s JOIN "TeacherAppDevice" d ON d.id = s."deviceId" WHERE s."organizationId" <> d."organizationId"`,
  },
  {
    label: "TeacherAppDeviceAuthSession rows match their User organization",
    sql: `SELECT COUNT(*)::int AS count FROM "TeacherAppDeviceAuthSession" s JOIN "User" u ON u.id = s."userId" WHERE s."organizationId" <> u."organizationId"`,
  },
  {
    label: "TeacherRecordingSession rows match their creator User organization",
    sql: `SELECT COUNT(*)::int AS count FROM "TeacherRecordingSession" r JOIN "User" u ON u.id = r."createdByUserId" WHERE r."organizationId" <> u."organizationId"`,
  },
  {
    label: "TeacherRecordingSession rows match selected Student organization when selectedStudentId is set",
    sql: `SELECT COUNT(*)::int AS count FROM "TeacherRecordingSession" r JOIN "Student" st ON st.id = r."selectedStudentId" WHERE r."selectedStudentId" IS NOT NULL AND r."organizationId" <> st."organizationId"`,
  },
  {
    label: "TeacherRecordingJob rows match their Recording organization",
    sql: `SELECT COUNT(*)::int AS count FROM "TeacherRecordingJob" j JOIN "TeacherRecordingSession" r ON r.id = j."recordingSessionId" WHERE j."organizationId" <> r."organizationId"`,
  },
  {
    label: "ProperNounGlossaryEntry rows match their Student organization when studentId is set",
    sql: `SELECT COUNT(*)::int AS count FROM "ProperNounGlossaryEntry" g JOIN "Student" st ON st.id = g."studentId" WHERE g."studentId" IS NOT NULL AND g."organizationId" <> st."organizationId"`,
  },
  {
    label: "ProperNounSuggestion rows match their Student organization",
    sql: `SELECT COUNT(*)::int AS count FROM "ProperNounSuggestion" p JOIN "Student" st ON st.id = p."studentId" WHERE p."organizationId" <> st."organizationId"`,
  },
  {
    label: "NextMeetingMemo rows match their Student organization",
    sql: `SELECT COUNT(*)::int AS count FROM "NextMeetingMemo" m JOIN "Student" st ON st.id = m."studentId" WHERE m."organizationId" <> st."organizationId"`,
  },
  {
    label: "NextMeetingMemo rows match their Session organization",
    sql: `SELECT COUNT(*)::int AS count FROM "NextMeetingMemo" m JOIN "Session" se ON se.id = m."sessionId" WHERE m."organizationId" <> se."organizationId"`,
  },
  {
    label: "NextMeetingMemo rows match their Conversation organization",
    sql: `SELECT COUNT(*)::int AS count FROM "NextMeetingMemo" m JOIN "ConversationLog" c ON c.id = m."conversationId" WHERE m."organizationId" <> c."organizationId"`,
  },
];

function resolveRepoPath(relativePath: string) {
  return path.join(root, relativePath);
}

async function runStaticChecks() {
  for (const check of staticChecks) {
    const fullPath = resolveRepoPath(check.file);
    assert.ok(existsSync(fullPath), `[static] missing file: ${check.file}`);
    const source = await readFile(fullPath, "utf8");
    for (const expected of check.mustInclude) {
      assert.ok(
        source.includes(expected),
        `[static] ${check.label}: expected ${check.file} to include ${JSON.stringify(expected)}`
      );
    }
  }
  console.log(`[static] ${staticChecks.length} tenant boundary source checks passed`);
}

function hasDatabaseConnectionConfig() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const directUrl = process.env.DIRECT_URL?.trim();
  if (databaseUrl) return true;
  return Boolean(directUrl && process.env.PARARIA_USE_DIRECT_DATABASE_URL?.trim() === "1");
}

async function loadOptionalEnv() {
  await loadEnvFile(resolveRepoPath(".env.local"), { optional: true, skipEmpty: true });
  await loadEnvFile(resolveRepoPath(".env"), { optional: true, skipEmpty: true });
}

function readCount(row: unknown) {
  const value = (row as { count?: unknown } | null)?.count;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return Number.NaN;
}

async function runDbChecks() {
  if (!hasDatabaseConnectionConfig()) {
    console.log("[db] skipped: DATABASE_URL is not set");
    return;
  }

  const dbModule = await import(pathToFileURL(resolveRepoPath("lib/db.ts")).href);
  const prisma = dbModule.prisma as {
    $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
    $disconnect(): Promise<void>;
  };

  try {
    for (const check of dbChecks) {
      const rows = await prisma.$queryRawUnsafe<Array<{ count: number | bigint | string }>>(check.sql);
      const count = readCount(rows[0]);
      assert.ok(Number.isFinite(count), `[db] ${check.label}: count was not numeric`);
      assert.equal(count, 0, `[db] ${check.label}: found ${count} boundary violation(s)`);
    }
    console.log(`[db] ${dbChecks.length} read-only tenant integrity checks passed`);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  await runStaticChecks();
  await loadOptionalEnv();
  await runDbChecks();
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
