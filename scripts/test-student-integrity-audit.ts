#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { prisma } from "@/lib/db";
import { withActiveStudentWhere } from "@/lib/students/student-lifecycle";
import {
  CRITICAL_PATH_ADMIN_EMAIL,
  createCriticalPathBrowserContext,
  loadCriticalPathSmokeEnv,
} from "./lib/critical-path-smoke";

type DirectoryStudent = {
  id: string;
  name: string;
  grade?: string | null;
  course?: string | null;
};

function argValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function suspiciousFixtureSignal(student: {
  id: string;
  name: string;
  course: string | null;
  guardianNames: string | null;
}) {
  const combined = `${student.id}\n${student.name}\n${student.course ?? ""}\n${student.guardianNames ?? ""}`;
  return /(student-smoke-|critical path|ui student|route student|smoke|demo)/i.test(combined);
}

async function main() {
  await loadCriticalPathSmokeEnv();

  const baseUrl = argValue("--base-url") || process.env.CRITICAL_PATH_BASE_URL || "https://pararia.vercel.app";
  const operationId = randomUUID();
  const allowedFixtureNames = new Set(
    (process.env.INTEGRITY_AUDIT_ALLOWED_TEST_STUDENT_NAMES ?? "田中太郎")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  );

  const admin = await prisma.user.findUnique({
    where: { email: CRITICAL_PATH_ADMIN_EMAIL },
    select: { id: true, organizationId: true },
  });
  assert.ok(admin?.organizationId, `[integrity-audit:${operationId}] admin organization not found`);

  const dbStudents = await prisma.student.findMany({
    where: withActiveStudentWhere({ organizationId: admin.organizationId }),
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      grade: true,
      course: true,
      guardianNames: true,
      createdAt: true,
      sessions: {
        orderBy: [{ sessionDate: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          studentId: true,
          type: true,
          status: true,
        },
      },
      conversations: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          studentId: true,
          sessionId: true,
          status: true,
        },
      },
      reports: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          studentId: true,
          sourceLogIds: true,
          status: true,
        },
      },
    },
  });

  const suspiciousStudents = dbStudents.filter(
    (student) => !allowedFixtureNames.has(student.name) && suspiciousFixtureSignal(student)
  );
  assert.equal(
    suspiciousStudents.length,
    0,
    `[integrity-audit:${operationId}] suspicious active fixture students detected: ${suspiciousStudents
      .map((student) => `${student.id}:${student.name}`)
      .join(", ")}`
  );

  const { context, close } = await createCriticalPathBrowserContext(baseUrl);
  const page = await context.newPage();

  try {
    const directoryResponse = await context.request.get(`${baseUrl}/api/students?limit=1000`);
    assert.equal(
      directoryResponse.ok(),
      true,
      `[integrity-audit:${operationId}] directory api failed: ${directoryResponse.status()}`
    );
    const directoryBody = await directoryResponse.json();
    const directoryStudents = Array.isArray(directoryBody.students) ? (directoryBody.students as DirectoryStudent[]) : [];
    assert.equal(
      directoryStudents.length,
      dbStudents.length,
      `[integrity-audit:${operationId}] directory count mismatch db=${dbStudents.length} api=${directoryStudents.length}`
    );

    const directoryById = new Map(directoryStudents.map((student) => [student.id, student]));

    await page.goto(`${baseUrl}/app/students`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    await page.getByRole("heading", { name: "生徒一覧" }).waitFor({ timeout: 20_000 });
    let uiCount = await page.locator('[data-student-row="1"]').count();
    if (uiCount === 0) {
      uiCount = await page.locator("article").count();
    }
    assert.equal(
      uiCount,
      dbStudents.length,
      `[integrity-audit:${operationId}] directory ui count mismatch db=${dbStudents.length} ui=${uiCount}`
    );

    let sessionCount = 0;
    let conversationCount = 0;
    let reportCount = 0;

    for (const student of dbStudents) {
      const directoryStudent = directoryById.get(student.id);
      assert.ok(directoryStudent, `[integrity-audit:${operationId}] directory missing student ${student.id}`);
      assert.equal(directoryStudent?.name ?? null, student.name);
      assert.equal(normalizeString(directoryStudent?.grade), student.grade ?? null);
      assert.equal(normalizeString(directoryStudent?.course), student.course ?? null);

      const detailResponse = await context.request.get(`${baseUrl}/api/students/${student.id}`);
      assert.equal(detailResponse.ok(), true, `[integrity-audit:${operationId}] student detail failed: ${student.id}`);
      const detailBody = await detailResponse.json();
      assert.equal(detailBody.student?.id, student.id);
      assert.equal(normalizeString(detailBody.student?.grade), student.grade ?? null);
      assert.equal(normalizeString(detailBody.student?.course), student.course ?? null);
      assert.equal(normalizeString(detailBody.student?.guardianNames), student.guardianNames ?? null);

      const roomResponse = await context.request.get(`${baseUrl}/api/students/${student.id}/room`);
      assert.equal(roomResponse.ok(), true, `[integrity-audit:${operationId}] student room failed: ${student.id}`);
      const roomBody = await roomResponse.json();
      assert.equal(roomBody.student?.id, student.id);
      assert.equal(normalizeString(roomBody.student?.grade), student.grade ?? null);
      assert.equal(normalizeString(roomBody.student?.course), student.course ?? null);
      assert.equal(normalizeString(roomBody.student?.guardianNames), student.guardianNames ?? null);

      const conversationIds = new Set(student.conversations.map((conversation) => conversation.id));
      if (roomBody.latestConversation?.id) {
        assert.equal(
          conversationIds.has(String(roomBody.latestConversation.id)),
          true,
          `[integrity-audit:${operationId}] latestConversation mismatch for student ${student.id}`
        );
      }

      for (const session of student.sessions) {
        sessionCount += 1;
        const sessionResponse = await context.request.get(`${baseUrl}/api/sessions/${session.id}`);
        assert.equal(sessionResponse.ok(), true, `[integrity-audit:${operationId}] session route failed: ${session.id}`);
        const sessionBody = await sessionResponse.json();
        assert.equal(sessionBody.session?.id, session.id);
        assert.equal(sessionBody.session?.student?.id, student.id);
      }

      for (const conversation of student.conversations) {
        conversationCount += 1;
        const conversationResponse = await context.request.get(`${baseUrl}/api/conversations/${conversation.id}`);
        assert.equal(
          conversationResponse.ok(),
          true,
          `[integrity-audit:${operationId}] conversation route failed: ${conversation.id}`
        );
        const conversationBody = await conversationResponse.json();
        assert.equal(conversationBody.conversation?.id, conversation.id);
        assert.equal(conversationBody.conversation?.student?.id, student.id);
        assert.equal(conversationBody.conversation?.session?.id ?? null, conversation.sessionId ?? null);
      }

      for (const report of student.reports) {
        reportCount += 1;
        const reportResponse = await context.request.get(`${baseUrl}/api/reports/${report.id}`);
        assert.equal(reportResponse.ok(), true, `[integrity-audit:${operationId}] report route failed: ${report.id}`);
        const reportBody = await reportResponse.json();
        assert.equal(reportBody.report?.id, report.id);
        assert.deepEqual(
          normalizeStringArray(reportBody.report?.sourceLogIds),
          normalizeStringArray(report.sourceLogIds),
          `[integrity-audit:${operationId}] report sourceLogIds mismatch: ${report.id}`
        );
        for (const logId of normalizeStringArray(reportBody.report?.sourceLogIds)) {
          assert.equal(
            conversationIds.has(logId),
            true,
            `[integrity-audit:${operationId}] report ${report.id} references conversation outside student ${student.id}: ${logId}`
          );
        }
      }
    }

    console.log(
      JSON.stringify(
        {
          label: "student-integrity-audit",
          operationId,
          baseUrl,
          studentCount: dbStudents.length,
          sessionCount,
          conversationCount,
          reportCount,
          allowedFixtureNames: Array.from(allowedFixtureNames),
        },
        null,
        2
      )
    );
  } finally {
    await page.close().catch(() => {});
    await close().catch(() => {});
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
