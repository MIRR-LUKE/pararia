#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function findFunctionBody(source: string, name: string) {
  const marker = `function ${name}`;
  const asyncMarker = `async function ${name}`;
  const exportAsyncMarker = `export async function ${name}`;
  const start =
    source.indexOf(exportAsyncMarker) >= 0
      ? source.indexOf(exportAsyncMarker)
      : source.indexOf(asyncMarker) >= 0
        ? source.indexOf(asyncMarker)
        : source.indexOf(marker);

  assert.notEqual(start, -1, `${name} が見つかりません。`);

  const openParen = source.indexOf("(", start);
  assert.notEqual(openParen, -1, `${name} の parameter 開始が見つかりません。`);

  let parenDepth = 0;
  let closeParen = -1;
  for (let index = openParen; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth -= 1;
    if (parenDepth === 0) {
      closeParen = index;
      break;
    }
  }

  assert.notEqual(closeParen, -1, `${name} の parameter 終端が見つかりません。`);

  const openBrace = source.indexOf("{", closeParen);
  assert.notEqual(openBrace, -1, `${name} の body 開始が見つかりません。`);

  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(openBrace + 1, index);
  }

  throw new Error(`${name} の body 終端が見つかりません。`);
}

function findPrismaCallBlocks(source: string, method: string) {
  const blocks: Array<{ model: string; block: string }> = [];
  const callPattern = new RegExp(`prisma\\.([a-zA-Z0-9_]+)\\.${method}\\s*\\(\\s*\\{`, "g");
  let match: RegExpExecArray | null;

  while ((match = callPattern.exec(source))) {
    const openBrace = source.indexOf("{", match.index);
    let depth = 0;
    for (let index = openBrace; index < source.length; index += 1) {
      const char = source[index];
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      if (depth === 0) {
        blocks.push({
          model: match[1],
          block: source.slice(openBrace, index + 1),
        });
        callPattern.lastIndex = index + 1;
        break;
      }
    }
  }

  return blocks;
}

function assertIncludes(source: string, expected: string, message: string) {
  assert.ok(source.includes(expected), message);
}

function assertNoIncludes(source: string, forbidden: string, message: string) {
  assert.equal(source.includes(forbidden), false, message);
}

const snapshot = read("lib/admin/platform-admin-snapshot.ts");
const metrics = read("lib/admin/platform-admin-campus-metrics.ts");
const jobs = read("lib/admin/platform-admin-jobs.ts");
const adminSnapshotSources = [snapshot, metrics, jobs].join("\n");
const adminApi = read("app/api/admin/platform/route.ts");
const adminPage = read("app/admin/page.tsx");
const campusApi = read("app/api/admin/campuses/[organizationId]/route.ts");
const schema = read("prisma/schema.prisma");

assertIncludes(snapshot, "const DEFAULT_TAKE = 100;", "admin snapshot must keep a modest default page size");
assertIncludes(snapshot, "const MAX_TAKE = 500;", "admin snapshot must cap platform list and summary reads");
assertIncludes(snapshot, "Math.min(MAX_TAKE", "normalizeTake must clamp user-supplied take");
assertIncludes(snapshot, "function normalizeSkip", "admin list must normalize skip");

const listBody = findFunctionBody(snapshot, "listAdminCampuses");
assertIncludes(listBody, "const take = normalizeTake(options.take);", "listAdminCampuses must normalize take");
assertIncludes(listBody, "const skip = normalizeSkip(options.skip);", "listAdminCampuses must normalize skip");
assertIncludes(listBody, "prisma.organization.count", "listAdminCampuses must count total rows separately");
assertIncludes(listBody, "prisma.organization.findMany", "listAdminCampuses must use a bounded organization query");
assertIncludes(listBody, "skip,", "organization list query must use skip");
assertIncludes(listBody, "take,", "organization list query must use take");
assertIncludes(listBody, "select:", "organization list query must explicitly select fields");
assertNoIncludes(listBody, "include:", "organization list must not include full relations");

const snapshotBody = findFunctionBody(snapshot, "getPlatformAdminSnapshot");
assertIncludes(
  snapshotBody,
  "take: MAX_TAKE",
  "summary aggregation must be bounded by MAX_TAKE until a materialized summary exists"
);
assertIncludes(snapshotBody, "getCrossCampusJobHealth", "snapshot must use the shared bounded job health builder");

assertIncludes(adminApi, "parseNumber(searchParams.get(\"skip\"))", "admin API must accept skip");
assertIncludes(adminApi, "parseNumber(searchParams.get(\"take\"))", "admin API must accept take");
assertIncludes(adminPage, "getPlatformAdminSnapshot({ operator, take: 100 })", "/admin initial render must request a bounded page");
assertIncludes(campusApi, "getPlatformCampusDetail", "campus detail route must stay separate from the cross-campus list payload");

const findManyBlocks = findPrismaCallBlocks(adminSnapshotSources, "findMany");
const intentionallyBoundedByPreviousTake = (model: string, block: string) =>
  model === "organization" && block.includes("id: { in: storageOrganizationIds }");
const scopedToCurrentPageCampuses = (block: string) => block.includes("organizationId: { in: organizationIds }");

for (const { model, block } of findManyBlocks) {
  assertIncludes(block, "select:", `prisma.${model}.findMany must explicitly select returned columns`);
  assertNoIncludes(block, "include:", `prisma.${model}.findMany must not include whole relations in admin snapshot`);
  if (!intentionallyBoundedByPreviousTake(model, block) && !scopedToCurrentPageCampuses(block)) {
    assertIncludes(
      block,
      "take",
      `prisma.${model}.findMany must be bounded by take, a prior take-limited id set, or current page campus ids`
    );
  }
}

const attentionBody = findFunctionBody(jobs, "listAdminAttentionItems");
for (const model of [
  "conversationJob",
  "sessionPartJob",
  "teacherRecordingJob",
  "storageDeletionRequest",
  "reportDeliveryEvent",
]) {
  const blocks = findManyBlocks.filter((entry) => entry.model === model && attentionBody.includes(entry.block));
  assert.ok(blocks.length >= 1, `listAdminAttentionItems must query ${model}`);
  for (const { block } of blocks) {
    assertIncludes(block, "take", `${model} attention query must be take-limited`);
    assertIncludes(block, "select:", `${model} attention query must explicitly select fields`);
  }
}

const metricsBody = findFunctionBody(metrics, "getCampusMetrics");
assertIncludes(metricsBody, "organizationId: { in: organizationIds }", "campus metrics must be scoped to the current page ids");
assertNoIncludes(metricsBody, "Promise.all(", "admin metrics should avoid unbounded fan-out Promise.all over campus data");
assertNoIncludes(adminSnapshotSources, "forEach(async", "admin snapshot must not use async forEach fan-out");
assertNoIncludes(adminSnapshotSources, ".map(async", "admin snapshot must not create per-row async fan-out");

for (const body of [listBody, metricsBody, attentionBody, snapshotBody]) {
  assertNoIncludes(body, "lastError", "admin performance payload must not select raw job errors");
  assertNoIncludes(body, "rawTextOriginal", "admin performance payload must not select transcript blobs");
  assertNoIncludes(body, "artifactJson", "admin performance payload must not select generated artifact blobs");
  assertNoIncludes(body, "reportMarkdown", "admin performance payload must not select report bodies");
}

const existingIndexHints = [
  "@@index([organizationId, archivedAt, createdAt])",
  "@@index([organizationId, createdAt])",
  "@@index([organizationId, deletedAt, createdAt])",
  "@@index([organizationId, status, updatedAt])",
  "@@index([targetOrganizationId, createdAt])",
];

for (const indexHint of existingIndexHints) {
  assertIncludes(schema, indexHint, `schema should retain existing admin-relevant index ${indexHint}`);
}

const recommendedIndexes = [
  "Organization: @@index([updatedAt, createdAt]) for /admin orderBy updatedAt desc, createdAt desc",
  "ConversationJob: @@index([status, updatedAt, createdAt]) and @@index([status, startedAt]) for health counts and oldest attention",
  "ConversationJob: @@index([status, leaseExpiresAt]) for stale RUNNING lease checks",
  "SessionPartJob: @@index([status, updatedAt, createdAt]) and @@index([status, startedAt]) for attention and oldest running",
  "TeacherRecordingJob: @@index([organizationId, status, updatedAt, createdAt]) and @@index([organizationId, status, startedAt])",
  "TeacherRecordingSession: @@index([organizationId, updatedAt]) and @@index([organizationId, recordedAt]) for last activity",
  "StorageDeletionRequest: @@index([organizationId, status, updatedAt]) and @@index([status, updatedAt, createdAt])",
  "ReportDeliveryEvent: @@index([organizationId, eventType, createdAt]) for failed/bounced counts and attention",
  "User: @@index([organizationId, role]) for campus detail user role groupBy",
  "OrganizationInvitation: @@index([organizationId, acceptedAt, expiresAt]) for pending/expired invitation counts",
];

console.log("admin platform performance smoke passed");
console.log("recommended admin indexes for parent schema integration:");
for (const index of recommendedIndexes) {
  console.log(`- ${index}`);
}
