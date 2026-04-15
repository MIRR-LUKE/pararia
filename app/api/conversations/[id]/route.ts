import { NextResponse } from "next/server";
import { requireAuthorizedMutationSession, requireAuthorizedSession } from "@/lib/server/request-auth";
import { resolveRouteId, type RouteParams } from "@/lib/server/route-params";
import { applyLightMutationThrottle } from "@/lib/server/request-throttle";
import {
  buildConversationReadResponse,
  deleteConversation,
  getConversationBrief,
  getConversationDetail,
  patchConversation,
  processVisibleConversation,
} from "./route-service";

function readDeleteReason(body: unknown) {
  const reason = (body as { reason?: unknown } | null)?.reason;
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 500) : null;
}

export async function GET(request: Request, { params }: { params: RouteParams }) {
  try {
    const conversationId = await resolveRouteId(params);
    if (!conversationId) {
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    }

    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    const organizationId = authResult.session.user.organizationId;

    const { searchParams } = new URL(request.url);
    const brief = searchParams.get("brief") === "1";

    if (brief) {
      const conversation = await getConversationBrief(conversationId, organizationId);
      if (!conversation) {
        return NextResponse.json({ error: "not found" }, { status: 404 });
      }
      return NextResponse.json({ conversation });
    }

    const conversation = await getConversationDetail(conversationId, organizationId);
    if (!conversation) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json(buildConversationReadResponse(conversation));
  } catch (error: any) {
    console.error("[GET /api/conversations/[id]] Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, { params }: { params: RouteParams }) {
  try {
    const conversationId = await resolveRouteId(params);
    if (!conversationId) {
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    }

    const authResult = await requireAuthorizedMutationSession(request);
    if (authResult.response) return authResult.response;
    const organizationId = authResult.session.user.organizationId;
    const throttleResponse = await applyLightMutationThrottle({
      request,
      scope: "conversations.process",
      userId: authResult.session.user.id,
      organizationId,
    });
    if (throttleResponse) return throttleResponse;

    const conversation = await getConversationBrief(conversationId, organizationId);
    if (!conversation) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    await processVisibleConversation(conversation.id, conversation.status);
    return GET(request, { params });
  } catch (error: any) {
    console.error("[POST /api/conversations/[id]] Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request, { params }: { params: RouteParams }) {
  try {
    const conversationId = await resolveRouteId(params);
    if (!conversationId) {
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    }

    const authResult = await requireAuthorizedMutationSession(request);
    if (authResult.response) return authResult.response;
    const organizationId = authResult.session.user.organizationId;
    const throttleResponse = await applyLightMutationThrottle({
      request,
      scope: "conversations.delete",
      userId: authResult.session.user.id,
      organizationId,
    });
    if (throttleResponse) return throttleResponse;

    const body = await request.json().catch(() => ({}));
    const deleteReason = readDeleteReason(body);
    const result = await deleteConversation(
      conversationId,
      organizationId,
      authResult.session.user.id,
      deleteReason
    );
    if (!result) {
      return NextResponse.json({ error: "conversation not found" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[DELETE /api/conversations/[id]] Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request, { params }: { params: RouteParams }) {
  try {
    const conversationId = await resolveRouteId(params);
    if (!conversationId) {
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    }

    const authResult = await requireAuthorizedMutationSession(request);
    if (authResult.response) return authResult.response;
    const organizationId = authResult.session.user.organizationId;
    const throttleResponse = await applyLightMutationThrottle({
      request,
      scope: "conversations.update",
      userId: authResult.session.user.id,
      organizationId,
    });
    if (throttleResponse) return throttleResponse;

    const body = await request.json().catch(() => ({}));
    const result = await patchConversation(conversationId, organizationId, body);
    if (!result) {
      return NextResponse.json({ error: "conversation not found" }, { status: 404 });
    }
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[PATCH /api/conversations/[id]] Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}
