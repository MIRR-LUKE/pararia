import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ConversationSourceType, ConversationStatus } from "@prisma/client";
import { preprocessTranscript } from "@/lib/transcript/preprocess";
import { enqueueConversationJobs, processAllConversationJobs } from "@/lib/jobs/conversationJobs";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import { requireAuthorizedMutationSession, requireAuthorizedSession } from "@/lib/server/request-auth";
import { renderConversationArtifactOrFallback } from "@/lib/conversation-artifact";
import { getLogListCacheTag } from "@/lib/logs/get-log-list-page-data";
import { getTranscriptExpiryDate } from "@/lib/system-config";
import { ensureConversationReviewedTranscript } from "@/lib/transcript/review";
import { withActiveStudentWhere } from "@/lib/students/student-lifecycle";
import { withVisibleConversationWhere } from "@/lib/content-visibility";
import { sanitizeSummaryMarkdown } from "@/lib/user-facing-japanese";
import { maybeStopRunpodWorkerWhenSessionPartQueueIdle } from "@/lib/runpod/idle-stop";
import { maybeEnsureRunpodWorker } from "@/lib/runpod/worker-control";
import { applyLightMutationThrottle } from "@/lib/server/request-throttle";
import { runAfterResponse } from "@/lib/server/after-response";

export async function GET(request: Request) {
  try {
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    const organizationId = authResult.session.user.organizationId;

    const { searchParams } = new URL(request.url);
    const studentId = searchParams.get("studentId");
    const typeFilter = searchParams.get("type");
    const limitRaw = searchParams.get("limit");
    const limitParam = limitRaw ? Number(limitRaw) : NaN;
    const limit =
      Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(Math.floor(limitParam), 200)
        : 50;

    if (studentId) {
      const sessionTypeFilter =
        typeFilter === "LESSON_REPORT" || typeFilter === "INTERVIEW" ? typeFilter : undefined;
      const conversations = await prisma.conversationLog.findMany({
        where: withVisibleConversationWhere({
          organizationId,
          studentId,
          student: { archivedAt: null },
          ...(sessionTypeFilter ? { session: { type: sessionTypeFilter } } : {}),
        }),
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          studentId: true,
          sessionId: true,
          status: true,
          reviewState: true,
          artifactJson: true,
          summaryMarkdown: true,
          formattedTranscript: true,
          createdAt: true,
          student: { select: { id: true, name: true, grade: true } },
          session: { select: { type: true } },
        },
      });

      const formattedConversations = conversations.map((conversation) => ({
        id: conversation.id,
        studentId: conversation.studentId,
        sessionId: conversation.sessionId,
        status: conversation.status,
        reviewState: conversation.reviewState,
        artifactJson: conversation.artifactJson,
        summaryMarkdown: sanitizeSummaryMarkdown(
          renderConversationArtifactOrFallback(conversation.artifactJson, conversation.summaryMarkdown)
        ),
        formattedTranscript: conversation.formattedTranscript,
        createdAt: conversation.createdAt,
        date: new Date(conversation.createdAt).toLocaleDateString("ja-JP"),
        student: conversation.student,
        sessionType: conversation.session?.type ?? null,
      }));

      return NextResponse.json({ conversations: formattedConversations });
    }

    const sessionTypeFilter =
      typeFilter === "LESSON_REPORT" || typeFilter === "INTERVIEW" ? typeFilter : undefined;

    const conversations = await prisma.conversationLog.findMany({
      where: withVisibleConversationWhere({
        organizationId,
        student: { archivedAt: null },
        ...(sessionTypeFilter ? { session: { type: sessionTypeFilter } } : {}),
      }),
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        studentId: true,
        sessionId: true,
        status: true,
        reviewState: true,
        artifactJson: true,
        summaryMarkdown: true,
        createdAt: true,
        student: { select: { id: true, name: true, grade: true } },
        session: { select: { type: true } },
      },
    });

    const formattedConversations = conversations.map((c) => ({
      id: c.id,
      studentId: c.studentId,
      sessionId: c.sessionId,
      status: c.status,
      reviewState: c.reviewState,
      artifactJson: c.artifactJson,
      summaryMarkdown: sanitizeSummaryMarkdown(
        renderConversationArtifactOrFallback(c.artifactJson, c.summaryMarkdown)
      ),
      createdAt: c.createdAt,
      date: new Date(c.createdAt).toLocaleDateString("ja-JP"),
      student: c.student,
      sessionType: c.session?.type ?? null,
    }));

    return NextResponse.json({ conversations: formattedConversations });
  } catch (error: any) {
    console.error("[GET /api/conversations] Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const authResult = await requireAuthorizedMutationSession(request);
    if (authResult.response) return authResult.response;
    const organizationId = authResult.session.user.organizationId;
    const userId = authResult.session.user.id;
    const throttleResponse = await applyLightMutationThrottle({
      request,
      scope: "conversations.create",
      userId,
      organizationId,
    });
    if (throttleResponse) return throttleResponse;

    const body = await request.json();
    const { studentId, transcript, sourceType } = body ?? {};

    if (!studentId) {
      return NextResponse.json({ error: "studentId is required" }, { status: 400 });
    }

    if (!transcript || typeof transcript !== "string" || transcript.trim().length === 0) {
      return NextResponse.json(
        { error: "transcript is required (async pipeline)" },
        { status: 400 }
      );
    }

    const student = await prisma.student.findFirst({
      where: withActiveStudentWhere({ id: studentId, organizationId }),
      select: { id: true, organizationId: true },
    });
    if (!student) {
      return NextResponse.json({ error: "student not found" }, { status: 404 });
    }

    const pre = preprocessTranscript(transcript);
    const conversation = await prisma.conversationLog.create({
      data: {
        organizationId,
        studentId,
        userId,
        sourceType:
          sourceType === "AUDIO" ? ConversationSourceType.AUDIO : ConversationSourceType.MANUAL,
        status: ConversationStatus.PROCESSING,
        rawTextOriginal: pre.rawTextOriginal,
        rawTextCleaned: pre.displayTranscript,
        reviewedText: null,
        reviewState: "NONE",
        rawTextExpiresAt: getTranscriptExpiryDate(),
      },
    });

    await ensureConversationReviewedTranscript(conversation.id);

    await enqueueConversationJobs(conversation.id);
    if (shouldRunBackgroundJobsInline()) {
      void (async () => {
        try {
          await processAllConversationJobs(conversation.id);
        } catch (error) {
          console.error("[POST /api/conversations] Background process failed:", error);
        } finally {
          await maybeStopRunpodWorkerWhenSessionPartQueueIdle().catch(() => {});
        }
      })();
    } else {
      runAfterResponse(async () => {
        await maybeEnsureRunpodWorker().catch((error) => {
          console.error("[POST /api/conversations] Runpod wake failed:", error);
        });
      }, "POST /api/conversations wake runpod");
    }

    revalidateTag(`student-directory:${organizationId}`, "max");
    revalidateTag(`dashboard-snapshot:${organizationId}`, "max");
    revalidateTag(getLogListCacheTag(organizationId), "max");
    revalidatePath("/app/dashboard");
    revalidatePath("/app/students");
    revalidatePath("/app/logs");
    revalidatePath(`/app/students/${studentId}`);

    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error: any) {
    console.error("[POST /api/conversations] Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}
