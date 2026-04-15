#!/usr/bin/env tsx

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ConversationSourceType, ConversationStatus, ReportStatus, SessionStatus } from "@prisma/client";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { assertRestoreDrillTargetSafe } from "./lib/environment-safety";
import { loadBackupEnv } from "./lib/load-backup-env";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  await loadBackupEnv(ROOT);

  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) {
    throw new Error("DATABASE_URL が必要です。");
  }
  assertRestoreDrillTargetSafe(databaseUrl, "backup-restore-drill");

  const [organization, users, students] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: DEFAULT_ORGANIZATION_ID },
      select: {
        id: true,
        name: true,
      },
    }),
    prisma.user.findMany({
      where: {
        organizationId: DEFAULT_ORGANIZATION_ID,
        email: { in: ["admin@demo.com", "manager@demo.com", "teacher@demo.com", "instructor@demo.com"] },
      },
      select: {
        email: true,
        role: true,
      },
    }),
    prisma.student.findMany({
      where: {
        organizationId: DEFAULT_ORGANIZATION_ID,
        archivedAt: null,
      },
      select: {
        id: true,
        name: true,
        sessions: {
          select: {
            id: true,
            status: true,
            type: true,
          },
        },
        conversations: {
          select: {
            id: true,
            status: true,
            sourceType: true,
          },
        },
        reports: {
          select: {
            id: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  assert.ok(organization, "organization should exist after restore");
  assert.ok(organization?.name, "organization name should remain");
  assert.equal(organization.name.length > 0, true, "organization name should remain");
  assert.equal(users.length, 4, "all demo users should be restored");

  const restoredStudentIds = new Set(students.map((student) => student.id));
  assert.equal(restoredStudentIds.has("student-demo-1"), true, "student-demo-1 should exist");
  assert.equal(restoredStudentIds.has("student-demo-2"), true, "student-demo-2 should exist");

  const hana = students.find((student) => student.id === "student-demo-1");
  assert.ok(hana, "student-demo-1 details should exist");
  assert.ok(hana.sessions.length > 0, "student-demo-1 should keep sessions");
  assert.ok(hana.conversations.length > 0, "student-demo-1 should keep conversations");
  assert.ok(hana.reports.length > 0, "student-demo-1 should keep reports");

  const aoi = students.find((student) => student.id === "student-demo-2");
  assert.ok(aoi, "student-demo-2 details should exist");
  assert.ok(aoi.sessions.length > 0, "student-demo-2 should keep sessions");
  assert.ok(aoi.conversations.length > 0, "student-demo-2 should keep conversations");
  assert.ok(aoi.reports.length > 0, "student-demo-2 should keep reports");

  const counts = {
    organization: organization.id,
    users: users.length,
    students: students.length,
    sessions: students.reduce((sum, student) => sum + student.sessions.length, 0),
    conversations: students.reduce((sum, student) => sum + student.conversations.length, 0),
    reports: students.reduce((sum, student) => sum + student.reports.length, 0),
  };

  assert.equal(
    students.some((student) =>
      student.sessions.some((session) => session.status === SessionStatus.DRAFT || session.status === SessionStatus.READY)
    ),
    true,
    "restored sessions should keep usable statuses"
  );
  assert.equal(
    students.some((student) =>
      student.conversations.some((conversation) => conversation.status === ConversationStatus.DONE)
    ),
    true,
    "restored conversations should keep done rows"
  );
  assert.equal(
    students.some((student) => student.reports.some((report) => report.status === ReportStatus.DRAFT || report.status === ReportStatus.SENT)),
    true,
    "restored reports should keep expected statuses"
  );
  assert.equal(
    students.some((student) => student.conversations.some((conversation) => conversation.sourceType === ConversationSourceType.AUDIO)),
    true,
    "restored conversations should keep audio rows"
  );

  console.log(
    JSON.stringify(
      {
        label: "backup-restore-drill",
        databaseUrl,
        counts,
        restoredStudentIds: Array.from(restoredStudentIds),
      },
      null,
      2
    )
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
