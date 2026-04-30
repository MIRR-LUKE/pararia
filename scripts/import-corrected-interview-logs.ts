import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { PrismaClient, Prisma } from "@prisma/client";
import { buildConversationArtifactFromMarkdown } from "@/lib/conversation-artifact";

type ImportedLog = {
  dateToken: string;
  studentName: string;
  tutorName: string;
  markdownPath: string;
  markdown: string;
  transcriptPath?: string;
  transcript?: string;
};

type ImportPlanItem = ImportedLog & {
  studentId?: string;
  matchedStudentName?: string;
  existingConversationId?: string;
  existingSessionId?: string;
  action: "create" | "skip-existing" | "missing-student" | "ambiguous-student";
  candidates: Array<{ id: string; name: string }>;
};

const ROOT = process.cwd();
const DEFAULT_LOG_DIR = "C:/Users/lukew/Desktop/生徒面談録音/面談ログ_校正版";
const DEFAULT_TRANSCRIPT_DIR = "C:/Users/lukew/Desktop/生徒面談録音/面談ログ_生成結果";
const IMPORT_TAG = "manual-corrected-audio-import-2026-04-30";
const STUDENT_NAME_ALIASES: Record<string, string> = {
  津田琳太郎: "津田琳太郎",
  福地: "福地百優",
  小田: "小田泰輝",
  高麗: "高麗大柊",
  小林: "小林敬児",
  真子: "真子喜望",
  岡部: "岡部りあ",
  沖田: "沖田紗也",
  古川: "古川雅晴",
  五月雨: "五月女真",
  山瀨: "山瀬莉代",
  山瀬: "山瀬莉代",
};
const PREFERRED_DB_STUDENT_NAMES: Record<string, string> = {
  福地: "福地　百優",
};

function parseArgs() {
  const args = new Map<string, string | boolean>();
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = process.argv[i + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, true);
      continue;
    }
    args.set(key, next);
    i += 1;
  }
  return {
    apply: args.get("apply") === true,
    envFile: typeof args.get("env-file") === "string" ? String(args.get("env-file")) : null,
    logDir: typeof args.get("log-dir") === "string" ? String(args.get("log-dir")) : DEFAULT_LOG_DIR,
    transcriptDir:
      typeof args.get("transcript-dir") === "string"
        ? String(args.get("transcript-dir"))
        : DEFAULT_TRANSCRIPT_DIR,
  };
}

async function loadEnvFile(envFile: string | null) {
  if (!envFile) return;
  const raw = await readFile(path.resolve(ROOT, envFile), "utf8");
  for (const line of raw.replace(/\r/g, "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function normalizeName(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[ \t\r\n　様さんくん君]/g, "")
    .replace(/瀨/g, "瀬")
    .trim();
}

function resolveStudentLookupName(fileStudentName: string) {
  const key = normalizeName(fileStudentName);
  return normalizeName(STUDENT_NAME_ALIASES[key] ?? fileStudentName);
}

function parseDate(dateToken: string) {
  const match = dateToken.match(/^(\d{2})(\d{2})$/);
  if (!match) throw new Error(`invalid date token: ${dateToken}`);
  const month = Number(match[1]);
  const day = Number(match[2]);
  return new Date(Date.UTC(2026, month - 1, day, 3, 0, 0));
}

function minutesFromMarkdown(markdown: string) {
  const match = markdown.match(/面談時間[:：]\s*(\d+)\s*分/);
  if (!match) return null;
  const minutes = Number(match[1]);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

function firstSummaryLine(markdown: string) {
  const lines = markdown
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const summaryIndex = lines.findIndex((line) => /^■\s*1\.\s*サマリー/.test(line));
  const afterSummary = summaryIndex >= 0 ? lines.slice(summaryIndex + 1) : lines;
  const line = afterSummary.find((item) => !item.startsWith("■ ") && !item.startsWith("- "));
  return line?.slice(0, 100) || null;
}

function stripTitle(markdown: string) {
  return markdown
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("# "))
    .join("\n")
    .trim();
}

function parseLogFileName(fileName: string) {
  const match = fileName.match(/^(\d{4})_(.+?)_(.+?)_面談ログ_校正版\.md$/);
  if (!match) return null;
  return {
    dateToken: match[1],
    studentName: match[2],
    tutorName: match[3],
  };
}

function isTranscriptFileFor(log: ImportedLog, fileName: string) {
  return (
    fileName.startsWith(`${log.dateToken}_${log.studentName}_`) &&
    fileName.endsWith("_生文字起こし.md")
  );
}

async function readImportedLogs(logDir: string, transcriptDir: string): Promise<ImportedLog[]> {
  const files = await readdir(logDir);
  const transcriptFiles = await readdir(transcriptDir).catch(() => []);
  const logs: ImportedLog[] = [];

  for (const fileName of files.sort()) {
    const parsed = parseLogFileName(fileName);
    if (!parsed) continue;
    const markdownPath = path.join(logDir, fileName);
    const markdown = stripTitle(await readFile(markdownPath, "utf8"));
    const log: ImportedLog = {
      ...parsed,
      markdownPath,
      markdown,
    };
    const transcriptFile = transcriptFiles.find((candidate) => isTranscriptFileFor(log, candidate));
    if (transcriptFile) {
      log.transcriptPath = path.join(transcriptDir, transcriptFile);
      log.transcript = await readFile(log.transcriptPath, "utf8");
    }
    logs.push(log);
  }

  return logs;
}

async function buildPlan(prisma: PrismaClient, logs: ImportedLog[]): Promise<ImportPlanItem[]> {
  const students = await prisma.student.findMany({
    where: { archivedAt: null },
    select: { id: true, name: true },
    orderBy: { createdAt: "desc" },
  });
  const studentsByNormalizedName = new Map<string, Array<{ id: string; name: string }>>();
  for (const student of students) {
    const key = normalizeName(student.name);
    const list = studentsByNormalizedName.get(key) ?? [];
    list.push(student);
    studentsByNormalizedName.set(key, list);
  }

  const plan: ImportPlanItem[] = [];
  for (const log of logs) {
    const preferredDbName = PREFERRED_DB_STUDENT_NAMES[normalizeName(log.studentName)];
    const rawCandidates = studentsByNormalizedName.get(resolveStudentLookupName(log.studentName)) ?? [];
    const candidates = preferredDbName
      ? rawCandidates.filter((student) => student.name === preferredDbName)
      : rawCandidates;
    const existing = await prisma.conversationLog.findFirst({
      where: {
        sourceType: "MANUAL",
        qualityMetaJson: {
          path: ["importTag"],
          equals: IMPORT_TAG,
        },
        ...(candidates.length === 1 ? { studentId: candidates[0].id } : {}),
      },
      select: { id: true, sessionId: true },
    });

    let action: ImportPlanItem["action"] = "create";
    if (candidates.length === 0) action = "missing-student";
    if (candidates.length > 1) action = "ambiguous-student";
    if (existing) action = "skip-existing";

    plan.push({
      ...log,
      studentId: candidates.length === 1 ? candidates[0].id : undefined,
      matchedStudentName: candidates.length === 1 ? candidates[0].name : undefined,
      existingConversationId: existing?.id,
      existingSessionId: existing?.sessionId ?? undefined,
      action,
      candidates,
    });
  }
  return plan;
}

function printPlan(plan: ImportPlanItem[]) {
  const rows = plan.map((item) => ({
    date: item.dateToken,
    fileStudent: item.studentName,
    dbStudent: item.matchedStudentName ?? "",
    action: item.action,
    candidates: item.candidates.map((candidate) => candidate.name).join(", "),
    transcript: item.transcript ? "yes" : "no",
  }));
  console.table(rows);
}

async function applyPlan(prisma: PrismaClient, plan: ImportPlanItem[]) {
  const creatable = plan.filter((item) => item.action === "create" && item.studentId);
  if (creatable.length === 0) {
    console.log("No new logs to import.");
    return;
  }

  for (const item of creatable) {
    const sessionDate = parseDate(item.dateToken);
    const durationMinutes = minutesFromMarkdown(item.markdown);
    const artifact = buildConversationArtifactFromMarkdown({
      sessionType: "INTERVIEW",
      summaryMarkdown: item.markdown,
      generatedAt: new Date(),
    });
    const heroOneLiner = firstSummaryLine(item.markdown);

    const created = await prisma.$transaction(async (tx) => {
      const session = await tx.session.create({
        data: {
          organizationId: (await tx.student.findUniqueOrThrow({
            where: { id: item.studentId! },
            select: { organizationId: true },
          })).organizationId,
          studentId: item.studentId!,
          type: "INTERVIEW",
          status: "READY",
          title: `${item.dateToken} 面談`,
          notes: `校正版面談ログの手動インポート: ${path.basename(item.markdownPath)}`,
          sessionDate,
          heroStateLabel: "面談ログ",
          heroOneLiner,
          latestSummary: item.markdown,
          completedAt: new Date(),
        },
        select: { id: true, organizationId: true },
      });

      const part = await tx.sessionPart.create({
        data: {
          sessionId: session.id,
          partType: "FULL",
          sourceType: "MANUAL",
          status: "READY",
          fileName: path.basename(item.transcriptPath ?? item.markdownPath),
          rawTextOriginal: item.transcript ?? item.markdown,
          rawTextCleaned: item.transcript ?? item.markdown,
          reviewedText: item.transcript ?? item.markdown,
          transcriptExpiresAt: null,
          qualityMetaJson: Prisma.JsonNull,
        },
        select: { id: true },
      });

      const conversation = await tx.conversationLog.create({
        data: {
          organizationId: session.organizationId,
          studentId: item.studentId!,
          sessionId: session.id,
          sourceType: "MANUAL",
          status: "DONE",
          rawTextOriginal: item.transcript ?? item.markdown,
          rawTextCleaned: item.transcript ?? item.markdown,
          reviewedText: item.transcript ?? item.markdown,
          reviewState: "RESOLVED",
          rawTextExpiresAt: null,
          artifactJson: artifact as any,
          summaryMarkdown: item.markdown,
          formattedTranscript: item.transcript ?? null,
          qualityMetaJson: {
            importTag: IMPORT_TAG,
            importedAt: new Date().toISOString(),
            importedFrom: item.markdownPath,
            transcriptImportedFrom: item.transcriptPath ?? null,
            modelFinalize: "manual-corrected",
            summaryCharCount: item.markdown.length,
            jobSecondsFinalize: 0,
            llmApiCallsFinalize: 0,
            llmCostUsd: 0,
            llmCostJpy: 0,
            llmCostUsdJpyRate: Number(process.env.OPENAI_COST_USD_JPY_RATE ?? process.env.USD_JPY_RATE ?? 160),
            costCurrency: "JPY",
            tutorName: item.tutorName,
            durationMinutes,
          } as any,
        },
        select: { id: true },
      });

      return { sessionId: session.id, sessionPartId: part.id, conversationId: conversation.id };
    });

    console.log(
      `imported ${item.studentName}: session=${created.sessionId} part=${created.sessionPartId} conversation=${created.conversationId}`
    );
  }
}

async function main() {
  const args = parseArgs();
  await loadEnvFile(args.envFile);
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required. Pass --env-file .tmp/.env.production.local or set env.");
  }

  const logs = await readImportedLogs(args.logDir, args.transcriptDir);
  const prisma = new PrismaClient();
  try {
    const plan = await buildPlan(prisma, logs);
    printPlan(plan);

    const blockers = plan.filter(
      (item) => item.action === "missing-student" || item.action === "ambiguous-student"
    );
    if (blockers.length > 0) {
      throw new Error(`Cannot import while ${blockers.length} student match issue(s) remain.`);
    }

    if (!args.apply) {
      console.log("Dry run only. Re-run with --apply to write DB rows.");
      return;
    }

    await applyPlan(prisma, plan);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
