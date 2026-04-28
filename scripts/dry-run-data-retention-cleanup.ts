#!/usr/bin/env tsx

import { prisma } from "../lib/db";
import { collectDataRetentionDryRunCandidates } from "../lib/data-retention-dry-run";
import { loadLocalEnvFiles } from "./lib/load-local-env";

function readArgValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

function printUsage() {
  console.log([
    "Usage:",
    "  npx tsx scripts/dry-run-data-retention-cleanup.ts --organization-id <orgId> [--json] [--limit 200] [--now 2026-04-28T00:00:00.000Z]",
    "",
    "This script is dry-run only. It lists retention cleanup candidate counts and IDs, and never deletes data.",
  ].join("\n"));
}

function parseDateArg(raw: string | null) {
  if (!raw) return new Date();
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`invalid --now value: ${raw}`);
  }
  return parsed;
}

function parseLimit(raw: string | null) {
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`invalid --limit value: ${raw}`);
  }
  return Math.floor(value);
}

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    printUsage();
    return;
  }

  await loadLocalEnvFiles();

  const organizationId = readArgValue("--organization-id")?.trim();
  if (!organizationId) {
    printUsage();
    throw new Error("--organization-id is required");
  }

  const result = await collectDataRetentionDryRunCandidates({
    client: prisma,
    organizationId,
    now: parseDateArg(readArgValue("--now")),
    idLimit: parseLimit(readArgValue("--limit")),
  });

  if (hasFlag("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`mode: ${result.mode}`);
  console.log(`willDelete: ${result.willDelete}`);
  console.log(`organizationId: ${result.organizationId}`);
  console.log(`ranAt: ${result.ranAt}`);
  console.log(`totalCandidateReferences: ${result.totalCandidateReferences}`);
  console.log("");
  console.log("retentionDays:");
  console.log(`- audio: ${result.retention.audioDays}`);
  console.log(`- transcript: ${result.retention.transcriptDays}`);
  console.log(`- teacherRecordingUnconfirmed: ${result.retention.teacherRecordingUnconfirmedDays}`);
  console.log(`- teacherRecordingError: ${result.retention.teacherRecordingErrorDays}`);
  console.log(`- teacherRecordingNoStudent: ${result.retention.teacherRecordingNoStudentDays}`);
  console.log("");
  console.log("candidates:");

  for (const group of result.groups) {
    console.log(`- ${group.key} (${group.targetType})`);
    console.log(`  label: ${group.label}`);
    console.log(`  cutoff: ${group.cutoff}`);
    console.log(`  count: ${group.count}`);
    console.log(`  ids: ${group.ids.length > 0 ? group.ids.join(", ") : "none"}`);
    if (group.truncated) {
      console.log(`  truncated: true (showing first ${result.idLimit} IDs)`);
    }
  }
}

main()
  .catch((error) => {
    console.error("[dry-run-data-retention-cleanup] failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
