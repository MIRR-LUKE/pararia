import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { processAllConversationJobs } from "@/lib/jobs/conversationJobs";
import { processAllSessionPartJobs } from "@/lib/jobs/sessionPartJobs";
import { buildSessionProgressState } from "@/lib/session-progress";
import { buildSummaryPreview } from "@/lib/session-part-meta";
import { requireAuthorizedSession } from "@/lib/server/request-auth";
import { pickDisplayTranscriptText } from "@/lib/transcript/source";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    const authSession = authResult.session;

    const session = await prisma.session.findFirst({
      where: {
        id: params.id,
        organizationId: authSession.user.organizationId,
      },
      include: {
        parts: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            partType: true,
            status: true,
            fileName: true,
            rawTextOriginal: true,
            rawTextCleaned: true,
            reviewedText: true,
            reviewState: true,
            qualityMetaJson: true,
          },
        },
        conversation: {
          select: {
            id: true,
            status: true,
            summaryMarkdown: true,
            createdAt: true,
            jobs: {
              select: {
                type: true,
                status: true,
                startedAt: true,
                finishedAt: true,
              },
            },
          },
        },
      },
    });

    if (!session) {
      return NextResponse.json({ error: "セッションが見つかりません。" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    if (searchParams.get("process") === "1") {
      void processAllSessionPartJobs(session.id).catch(() => {});
      if (session.conversation?.id) {
        void processAllConversationJobs(session.conversation.id).catch(() => {});
      }
    }

    const progress = buildSessionProgressState({
      sessionId: session.id,
      type: session.type,
      parts: session.parts,
      conversation: session.conversation,
    });

    return NextResponse.json({
      session: {
        id: session.id,
        type: session.type,
        status: session.status,
      },
      conversation: session.conversation,
      parts: session.parts.map((part) => ({
        id: part.id,
        partType: part.partType,
        status: part.status,
        fileName: part.fileName,
        previewText: buildSummaryPreview(
          pickDisplayTranscriptText({
            rawTextCleaned: part.rawTextCleaned,
            reviewedText: part.reviewedText,
            rawTextOriginal: part.rawTextOriginal,
          })
        ),
        reviewState: part.reviewState,
        qualityMetaJson: part.qualityMetaJson,
      })),
      progress,
    });
  } catch (error: any) {
    console.error("[GET /api/sessions/[id]/progress] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
