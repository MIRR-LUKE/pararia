#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { prisma } from "@/lib/db";
import {
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
};

function argValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

export async function runReportGenerationRouteSmoke(baseUrl: string): Promise<ReportGenerationRouteSmokeResult> {
  await loadCriticalPathSmokeEnv();
  process.env.CRITICAL_PATH_BASE_URL = baseUrl;
  const fixture = await createReportGenerationFixture();
  const client = await loginForCriticalPathSmoke(baseUrl);
  const idempotencyKey = `report-generation-route-${fixture.sessionId}`;

  try {
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

    const roomResponse = await client.requestJson<{
      reports?: Array<{ id?: string; sourceLogIds?: string[] }>;
    }>(`/api/students/${fixture.studentId}/room`);
    assert.equal(roomResponse.response.status, 200, `student room failed: ${roomResponse.response.status}`);
    assert.equal(roomResponse.body.reports?.[0]?.id, reportId, "latest report should be visible in student room");
    assert.ok(roomResponse.body.reports?.[0]?.sourceLogIds?.includes(fixture.conversationId));

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
    };
  } finally {
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
