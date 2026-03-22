import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await prisma.session.findUnique({
      where: { id: params.id },
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
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const data: Record<string, unknown> = {};
    if (body?.title !== undefined) data.title = body.title || null;
    if (body?.notes !== undefined) data.notes = body.notes || null;
    if (body?.sessionDate !== undefined) data.sessionDate = body.sessionDate ? new Date(body.sessionDate) : new Date();

    const session = await prisma.session.update({
      where: { id: params.id },
      data,
    });

    return NextResponse.json({ session });
  } catch (error: any) {
    console.error("[PATCH /api/sessions/[id]] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
