import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuthorizedMutationSession, requireAuthorizedSession } from "@/lib/server/request-auth";
import { applyLightMutationThrottle } from "@/lib/server/request-throttle";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await Promise.resolve(params);
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    const session = await prisma.session.findFirst({
      where: {
        id,
        organizationId: authResult.session.user.organizationId,
      },
      include: {
        parts: {
          orderBy: { createdAt: "asc" },
        },
        conversation: {
          include: {
            jobs: {
              orderBy: { createdAt: "asc" },
            },
          },
        },
        student: {
          select: {
            id: true,
            name: true,
            grade: true,
            course: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });

    if (!session) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }

    return NextResponse.json({ session });
  } catch (error: any) {
    console.error("[GET /api/sessions/[id]] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await Promise.resolve(params);
    const authResult = await requireAuthorizedMutationSession(request);
    if (authResult.response) return authResult.response;
    const throttleResponse = await applyLightMutationThrottle({
      request,
      scope: "sessions.update",
      userId: authResult.session.user.id,
      organizationId: authResult.session.user.organizationId,
    });
    if (throttleResponse) return throttleResponse;
    const body = await request.json();
    const data: Record<string, unknown> = {};
    if (body?.title !== undefined) data.title = body.title || null;
    if (body?.notes !== undefined) data.notes = body.notes || null;
    if (body?.sessionDate !== undefined) data.sessionDate = body.sessionDate ? new Date(body.sessionDate) : new Date();

    const existing = await prisma.session.findFirst({
      where: {
        id,
        organizationId: authResult.session.user.organizationId,
      },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }

    const session = await prisma.session.update({
      where: { id: existing.id },
      data,
    });

    return NextResponse.json({ session });
  } catch (error: any) {
    console.error("[PATCH /api/sessions/[id]] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
