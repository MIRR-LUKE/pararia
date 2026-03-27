import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuthorizedSession } from "@/lib/server/request-auth";
import {
  ensureConversationReviewedTranscript,
  listConversationProperNounSuggestions,
} from "@/lib/transcript/review";

async function ensureOwnedConversation(conversationId: string, organizationId: string) {
  const conversation = await prisma.conversationLog.findFirst({
    where: {
      id: conversationId,
      organizationId,
    },
    select: { id: true },
  });
  if (!conversation) {
    throw new Error("conversation not found");
  }
  return conversation;
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    await ensureOwnedConversation(params.id, authResult.session.user.organizationId);

    const review = await listConversationProperNounSuggestions(params.id);
    return NextResponse.json({ review });
  } catch (error: any) {
    console.error("[GET /api/conversations/[id]/review] Error:", error);
    const status = /not found/i.test(String(error?.message ?? "")) ? 404 : 500;
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status });
  }
}

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    await ensureOwnedConversation(params.id, authResult.session.user.organizationId);

    await ensureConversationReviewedTranscript(params.id);
    const review = await listConversationProperNounSuggestions(params.id);
    return NextResponse.json({ ok: true, review });
  } catch (error: any) {
    console.error("[POST /api/conversations/[id]/review] Error:", error);
    const status = /not found/i.test(String(error?.message ?? "")) ? 404 : 500;
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status });
  }
}
