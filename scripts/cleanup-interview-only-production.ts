#!/usr/bin/env tsx

import { loadLocalEnvFiles } from "./lib/load-local-env";
import { isLocalPrismaDatasource } from "./lib/environment-safety";

type CleanupPlan = {
  canonicalSessionIds: string[];
  deleteSessionIds: string[];
  demoLessonSessionId: string;
  demoReportId: string;
};

const PLAN: CleanupPlan = {
  canonicalSessionIds: ["cmoa37s190002ohlw5ed1zpo4", "amagai-real-moc8auni-48e03a15"],
  deleteSessionIds: ["cmoavl2ro000ahss1yfsl11p2", "cmo9zd12c000evnq49si6idtq", "cmo9z5q060002vnq4bqc133rf"],
  demoLessonSessionId: "session-demo-1-lesson",
  demoReportId: "report-demo-1",
};

function hasFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

function readArg(name: string) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function assertCleanupAllowed() {
  if (isLocalPrismaDatasource()) return;
  if (process.env.PARARIA_ALLOW_REMOTE_FIXTURES?.trim() === "1") return;
  throw new Error(
    "[cleanup-interview-only-production] remote cleanup is blocked. " +
      "Set PARARIA_ALLOW_REMOTE_FIXTURES=1 only when you intentionally want to mutate the configured remote database."
  );
}

async function main() {
  await loadLocalEnvFiles();
  assertCleanupAllowed();

  const execute = hasFlag("execute");
  const verbose = hasFlag("verbose");
  const { prisma } = await import("../lib/db");
  const { deleteStorageEntryDetailed } = await import("../lib/audio-storage");

  try {
    const sessionsToDelete = await prisma.session.findMany({
      where: { id: { in: PLAN.deleteSessionIds } },
      select: {
        id: true,
        studentId: true,
        status: true,
        parts: {
          select: {
            id: true,
            partType: true,
            storageUrl: true,
            jobs: {
              select: { id: true },
            },
          },
        },
        conversation: {
          select: {
            id: true,
            jobs: { select: { id: true } },
            properNounSuggestions: { select: { id: true } },
            nextMeetingMemo: { select: { id: true } },
          },
        },
        nextMeetingMemo: { select: { id: true } },
        properNounSuggestions: { select: { id: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const reservationsBySessionId = new Map(
      (
        await prisma.blobUploadReservation.findMany({
          where: {
            sessionId: { in: PLAN.deleteSessionIds },
          },
          select: {
            id: true,
            sessionId: true,
          },
        })
      ).map((row) => [row.id, row])
    );

    const canonicalSessions = await prisma.session.findMany({
      where: { id: { in: PLAN.canonicalSessionIds } },
      select: {
        id: true,
        status: true,
        conversation: { select: { id: true, status: true } },
        nextMeetingMemo: { select: { status: true } },
      },
    });

    const demoLessonSession = await prisma.session.findUnique({
      where: { id: PLAN.demoLessonSessionId },
      select: {
        id: true,
        status: true,
        parts: {
          select: {
            id: true,
            partType: true,
            jobs: { select: { id: true } },
          },
        },
        conversation: {
          select: {
            id: true,
            jobs: { select: { id: true } },
          },
        },
      },
    });

    const demoReport = await prisma.report.findUnique({
      where: { id: PLAN.demoReportId },
      select: {
        id: true,
        sourceLogIds: true,
      },
    });

    const summary = {
      execute,
      canonicalSessions,
      sessionsToDelete: sessionsToDelete.map((session) => ({
        id: session.id,
        studentId: session.studentId,
        status: session.status,
        partIds: session.parts.map((part) => part.id),
        conversationId: session.conversation?.id ?? null,
        blobReservationIds: Array.from(reservationsBySessionId.values())
          .filter((item) => item.sessionId === session.id)
          .map((item) => item.id),
      })),
      demoLessonSession,
      demoReport,
    };

    console.log(JSON.stringify(summary, null, 2));

    if (!execute) {
      console.log(
        "[cleanup-interview-only-production] dry-run only. Re-run with --execute after reviewing the plan."
      );
      return;
    }

    const storageResults: Array<{ storageUrl: string; ok: boolean; error?: string }> = [];

    for (const session of sessionsToDelete) {
      const storageUrls = session.parts
        .map((part) => part.storageUrl)
        .filter((value): value is string => Boolean(value));

      await prisma.$transaction(async (tx) => {
        if (session.conversation?.id) {
          await tx.conversationJob.deleteMany({ where: { conversationId: session.conversation.id } });
          await tx.properNounSuggestion.deleteMany({ where: { conversationId: session.conversation.id } });
          await tx.nextMeetingMemo.deleteMany({ where: { conversationId: session.conversation.id } });
          await tx.conversationLog.deleteMany({ where: { id: session.conversation.id } });
        }

        await tx.properNounSuggestion.deleteMany({ where: { sessionId: session.id } });
        await tx.nextMeetingMemo.deleteMany({ where: { sessionId: session.id } });
        await tx.sessionPartJob.deleteMany({ where: { sessionPartId: { in: session.parts.map((part) => part.id) } } });
        await tx.blobUploadReservation.deleteMany({ where: { sessionId: session.id } });
        await tx.sessionPart.deleteMany({ where: { sessionId: session.id } });
        await tx.session.deleteMany({ where: { id: session.id } });
      });

      for (const storageUrl of storageUrls) {
        const result = await deleteStorageEntryDetailed(storageUrl);
        storageResults.push({ storageUrl, ...result });
      }
    }

    if (demoLessonSession) {
      await prisma.$transaction(async (tx) => {
        if (demoLessonSession.conversation?.id) {
          await tx.conversationJob.deleteMany({ where: { conversationId: demoLessonSession.conversation.id } });
          await tx.properNounSuggestion.deleteMany({ where: { conversationId: demoLessonSession.conversation.id } });
          await tx.nextMeetingMemo.deleteMany({ where: { conversationId: demoLessonSession.conversation.id } });
          await tx.conversationLog.deleteMany({ where: { id: demoLessonSession.conversation.id } });
        }

        await tx.sessionPartJob.deleteMany({
          where: { sessionPartId: { in: demoLessonSession.parts.map((part) => part.id) } },
        });
        await tx.sessionPart.deleteMany({ where: { sessionId: demoLessonSession.id } });
        await tx.session.deleteMany({ where: { id: demoLessonSession.id } });

        if (demoReport?.id) {
          await tx.report.delete({ where: { id: demoReport.id } });
        }
      });
    }

    const finalAmagaiSessions = await prisma.session.findMany({
      where: {
        student: {
          name: { contains: "雨貝" },
        },
      },
      select: {
        id: true,
        status: true,
        conversation: { select: { id: true, status: true } },
        nextMeetingMemo: { select: { status: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const finalLessonSessions = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM "Session"
      WHERE "type"::text = 'LESSON_REPORT'
    `;

    console.log(
      JSON.stringify(
        {
          deletedSessionIds: sessionsToDelete.map((session) => session.id),
          storageResults,
          finalAmagaiSessions,
          finalLessonSessions,
        },
        null,
        2
      )
    );

    if (verbose) {
      console.log("[cleanup-interview-only-production] execute completed");
    }
  } finally {
    const { prisma } = await import("../lib/db");
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch((error) => {
  console.error("[cleanup-interview-only-production] fatal", error);
  process.exitCode = 1;
});
