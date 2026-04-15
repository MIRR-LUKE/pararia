import { NextResponse } from "next/server";
import { ProperNounSuggestionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAuthorizedMutationSession } from "@/lib/server/request-auth";
import { normalizeRouteParam, resolveRouteParams, type RouteParams } from "@/lib/server/route-params";
import {
  listConversationProperNounSuggestions,
  updateProperNounSuggestionDecision,
} from "@/lib/transcript/review";
import { applyLightMutationThrottle } from "@/lib/server/request-throttle";

function parseSuggestionStatus(value: unknown) {
  if (value === ProperNounSuggestionStatus.CONFIRMED) return ProperNounSuggestionStatus.CONFIRMED;
  if (value === ProperNounSuggestionStatus.REJECTED) return ProperNounSuggestionStatus.REJECTED;
  if (value === ProperNounSuggestionStatus.MANUALLY_EDITED) return ProperNounSuggestionStatus.MANUALLY_EDITED;
  return null;
}

async function ensureOwnedSuggestion(input: {
  conversationId: string;
  suggestionId: string;
  organizationId: string;
}) {
  const suggestion = await prisma.properNounSuggestion.findFirst({
    where: {
      id: input.suggestionId,
      OR: [
        {
          conversation: {
            id: input.conversationId,
            organizationId: input.organizationId,
          },
        },
        {
          sessionPart: {
            session: {
              conversation: {
                id: input.conversationId,
                organizationId: input.organizationId,
              },
            },
          },
        },
      ],
    },
    select: { id: true },
  });
  if (!suggestion) {
    throw new Error("proper noun suggestion not found");
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; suggestionId: string }> }
) {
  try {
    const { id, suggestionId } = await Promise.resolve(params);
    const authResult = await requireAuthorizedMutationSession(request);
    if (authResult.response) return authResult.response;
    const throttleResponse = await applyLightMutationThrottle({
      request,
      scope: "conversations.review.suggestions",
      userId: authResult.session.user.id,
      organizationId: authResult.session.user.organizationId,
    });
    if (throttleResponse) return throttleResponse;
    await ensureOwnedSuggestion({
      conversationId: id,
      suggestionId,
      organizationId: authResult.session.user.organizationId,
    });

    const body = await request.json().catch(() => ({}));
    const status = parseSuggestionStatus(body?.status);
    if (!status) {
      return NextResponse.json({ error: "status is invalid" }, { status: 400 });
    }
    if (status === ProperNounSuggestionStatus.MANUALLY_EDITED && !String(body?.finalValue ?? "").trim()) {
      return NextResponse.json({ error: "finalValue is required for manually edited suggestion" }, { status: 400 });
    }

    await updateProperNounSuggestionDecision({
      suggestionId,
      status,
      finalValue: typeof body?.finalValue === "string" ? body.finalValue : null,
    });

    const review = await listConversationProperNounSuggestions(id);
    return NextResponse.json({ ok: true, review });
  } catch (error: any) {
    console.error("[PATCH /api/conversations/[id]/review/suggestions/[suggestionId]] Error:", error);
    const status = /not found/i.test(String(error?.message ?? "")) ? 404 : 500;
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status });
  }
}
