#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { prisma } from "@/lib/db";
import {
  createInvalidReportGenerationFixture,
  createReportGenerationFixture,
  loadCriticalPathSmokeEnv,
  loginForCriticalPathSmoke,
} from "./lib/critical-path-smoke";

type ReportGenerationRouteSmokeResult = {
  studentId: string;
  sessionId: string;
  conversationId: string;
  reportId: string;
  reportCount: number;
  generationModel: string | null;
  operationId: string;
};

type OperationErrorBody = {
  error?: string;
  route?: string;
  stage?: string;
  reason?: string;
  operationId?: string;
};

function argValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function assertOperationId(value: unknown, label: string) {
  assert.equal(typeof value, "string", `${label}: operationId should be a string`);
  assert.match(String(value), /^[0-9a-f-]{36}$/i, `${label}: operationId should look like uuid`);
}

function assertOperationErrorBody(
  body: OperationErrorBody,
  expectations: {
    route: string;
    stage: string;
    reason: string;
  },
  label: string
) {
  assert.equal(typeof body.error, "string", `${label}: error should be present`);
  assert.equal(body.route, expectations.route, `${label}: route`);
  assert.equal(body.stage, expectations.stage, `${label}: stage`);
  assert.equal(body.reason, expectations.reason, `${label}: reason`);
  assertOperationId(body.operationId, label);
}

export async function runReportGenerationRouteSmoke(baseUrl: string): Promise<ReportGenerationRouteSmokeResult> {
  await loadCriticalPathSmokeEnv();
  process.env.CRITICAL_PATH_BASE_URL = baseUrl;
  const fixture = await createReportGenerationFixture();
  const invalidFixture = await createInvalidReportGenerationFixture();
  const client = await loginForCriticalPathSmoke(baseUrl);
  const idempotencyKey = `report-generation-route-${fixture.sessionId}`;

  try {
    const missingSelection = await client.requestJson<OperationErrorBody>("/api/ai/generate-report", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: baseUrl,
      },
      body: JSON.stringify({
        studentId: fixture.studentId,
      }),
    });
    assert.equal(missingSelection.response.status, 400, "missing selection should be rejected");
    assertOperationErrorBody(
      missingSelection.body,
      {
        route: "generate-report",
        stage: "validate_selection",
        reason: "missing_log_selection",
      },
      "missing selection"
    );

    const missingStudent = await client.requestJson<OperationErrorBody>("/api/ai/generate-report", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: baseUrl,
      },
      body: JSON.stringify({
        studentId: "student-missing-for-report-generation",
        sessionIds: [fixture.sessionId],
      }),
    });
    assert.equal(missingStudent.response.status, 404, "missing student should be rejected");
    assertOperationErrorBody(
      missingStudent.body,
      {
        route: "generate-report",
        stage: "student_lookup",
        reason: "student_not_found",
      },
      "missing student"
    );

    const missingLogs = await client.requestJson<OperationErrorBody>("/api/ai/generate-report", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: baseUrl,
      },
      body: JSON.stringify({
        studentId: fixture.studentId,
        sessionIds: ["session-missing-for-report-generation"],
      }),
    });
    assert.equal(missingLogs.response.status, 400, "unknown selection should be rejected");
    assertOperationErrorBody(
      missingLogs.body,
      {
        route: "generate-report",
        stage: "load_selected_logs",
        reason: "selected_logs_not_found",
      },
      "selected logs not found"
    );

    const invalidArtifact = await client.requestJson<OperationErrorBody>("/api/ai/generate-report", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: baseUrl,
      },
      body: JSON.stringify({
        studentId: invalidFixture.studentId,
        sessionIds: [invalidFixture.sessionId],
      }),
    });
    assert.equal(invalidArtifact.response.status, 400, "invalid artifact should be rejected");
    assertOperationErrorBody(
      invalidArtifact.body,
      {
        route: "generate-report",
        stage: "validate_artifact",
        reason: "invalid_selected_artifact",
      },
      "invalid artifact"
    );
    assert.match(String(invalidArtifact.body.error), /再生成/, "invalid artifact should explain recovery path");

    const createResponse = await client.requestJson<{ report?: { id?: string } }>("/api/ai/generate-report", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: baseUrl,
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        studentId: fixture.studentId,
        sessionIds: [fixture.sessionId],
      }),
    });

    assert.equal(createResponse.response.status, 200, `report generate failed: ${createResponse.response.status}`);
    assertOperationId((createResponse.body as { operationId?: unknown }).operationId, "generate report success");
    assert.equal((createResponse.body as { stage?: unknown }).stage, "persist_report", "generate report success stage");
    const reportId = createResponse.body.report?.id ?? null;
    assert.ok(reportId, "report id is required");

    const repeatedResponse = await client.requestJson<{ report?: { id?: string } }>("/api/ai/generate-report", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: baseUrl,
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        studentId: fixture.studentId,
        sessionIds: [fixture.sessionId],
      }),
    });
    assert.equal(repeatedResponse.response.status, 200, `idempotent replay failed: ${repeatedResponse.response.status}`);
    assert.equal(repeatedResponse.body.report?.id, reportId, "idempotent replay should return the same report");
    assert.equal(
      (repeatedResponse.body as { operationId?: unknown }).operationId,
      (createResponse.body as { operationId?: unknown }).operationId,
      "idempotent replay should return the same operationId"
    );
    assert.equal((repeatedResponse.body as { stage?: unknown }).stage, "persist_report", "idempotent replay stage");

    const persistedReport = await prisma.report.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        reportMarkdown: true,
        reportJson: true,
        sourceLogIds: true,
        qualityChecksJson: true,
      },
    });
    assert.ok(persistedReport, "report should be persisted");
    assert.ok(persistedReport?.reportMarkdown?.includes("いつも大変お世話になっております。"), "report greeting");
    assert.ok(Array.isArray(persistedReport?.sourceLogIds), "sourceLogIds should be stored");
    assert.ok((persistedReport?.sourceLogIds as unknown[]).includes(fixture.conversationId), "source log should be preserved");

    const generationModel =
      persistedReport?.qualityChecksJson &&
      typeof persistedReport.qualityChecksJson === "object" &&
      !Array.isArray(persistedReport.qualityChecksJson) &&
      typeof (persistedReport.qualityChecksJson as { generationMeta?: { model?: unknown } }).generationMeta?.model === "string"
        ? String((persistedReport.qualityChecksJson as { generationMeta?: { model?: string } }).generationMeta?.model)
        : null;
    assert.equal(generationModel, "smoke-fixture:parent-report");

    const reportDetail = await client.requestJson<{
      report?: {
        id?: string;
        reportMarkdown?: string | null;
        reportJson?: { salutation?: string | null };
        sourceLogIds?: string[];
      };
    }>(`/api/reports/${reportId}`);
    assert.equal(reportDetail.response.status, 200, `report detail failed: ${reportDetail.response.status}`);
    assert.equal(reportDetail.body.report?.id, reportId);
    assert.ok(reportDetail.body.report?.reportMarkdown?.includes("今後ともどうぞよろしくお願いいたします。"));
    assert.equal(reportDetail.body.report?.reportJson?.salutation?.endsWith("いつも大変お世話になっております。"), true);
    assert.ok(reportDetail.body.report?.sourceLogIds?.includes(fixture.conversationId), "report detail should include source log");

    const missingReportDetail = await client.requestJson<OperationErrorBody>(`/api/reports/report-missing-for-smoke`);
    assert.equal(missingReportDetail.response.status, 404, "missing report detail should be rejected");
    assertOperationErrorBody(
      missingReportDetail.body,
      {
        route: "report-detail",
        stage: "load_report_detail",
        reason: "report_not_found",
      },
      "missing report detail"
    );

    const roomResponse = await client.requestJson<{
      reports?: Array<{ id?: string; sourceLogIds?: string[] }>;
    }>(`/api/students/${fixture.studentId}/room`);
    assert.equal(roomResponse.response.status, 200, `student room failed: ${roomResponse.response.status}`);
    assert.equal(roomResponse.body.reports?.[0]?.id, reportId, "latest report should be visible in student room");
    assert.ok(roomResponse.body.reports?.[0]?.sourceLogIds?.includes(fixture.conversationId));

    const missingRoom = await client.requestJson<OperationErrorBody>(`/api/students/student-missing-for-room/room`);
    assert.equal(missingRoom.response.status, 404, "missing room should be rejected");
    assertOperationErrorBody(
      missingRoom.body,
      {
        route: "student-room",
        stage: "student_lookup",
        reason: "student_not_found",
      },
      "missing student room"
    );

    const reportCount = await prisma.report.count({
      where: { studentId: fixture.studentId },
    });
    assert.equal(reportCount, 1, "idempotent replay should not create duplicate reports");

    return {
      studentId: fixture.studentId,
      sessionId: fixture.sessionId,
      conversationId: fixture.conversationId,
      reportId,
      reportCount,
      generationModel,
      operationId: String((createResponse.body as { operationId?: string }).operationId),
    };
  } finally {
    await invalidFixture.cleanup().catch(() => {});
    await fixture.cleanup().catch(() => {});
    await client.close().catch(() => {});
  }
}

async function main() {
  const baseUrl = argValue("--base-url") || process.env.CRITICAL_PATH_BASE_URL || "http://127.0.0.1:3000";
  const result = await runReportGenerationRouteSmoke(baseUrl);
  console.log(JSON.stringify({ label: "report-generation-route", baseUrl, result }, null, 2));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
