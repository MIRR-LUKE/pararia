import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuthorizedSession } from "@/lib/server/request-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function normalizeGuardianNames(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value)) {
    const joined = value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .join(" / ");
    return joined.length > 0 ? joined : null;
  }
  throw new TypeError("guardianNames must be a string, string[], or null");
}

export async function GET(request: Request) {
  try {
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    const organizationId = authResult.session.user.organizationId;

    const { searchParams } = new URL(request.url);
    const limitRaw = searchParams.get("limit");
    const limit = limitRaw ? Math.max(1, Math.min(200, Number(limitRaw))) : undefined;

    const now = new Date();
    const students = await prisma.student.findMany({
      where: {
        organizationId,
      },
      ...(limit && Number.isFinite(limit) ? { take: Math.floor(limit) } : {}),
      select: {
        id: true,
        organizationId: true,
        name: true,
        nameKana: true,
        grade: true,
        course: true,
        enrollmentDate: true,
        birthdate: true,
        guardianNames: true,
        createdAt: true,
        updatedAt: true,
        profiles: {
          select: {
            profileData: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        conversations: {
          select: {
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        sessions: {
          select: {
            id: true,
            status: true,
            type: true,
            sessionDate: true,
            heroStateLabel: true,
            heroOneLiner: true,
            latestSummary: true,
            conversation: {
              select: {
                id: true,
              },
            },
          },
          orderBy: { sessionDate: "desc" },
          take: 1,
        },
        reports: {
          select: {
            id: true,
            status: true,
            reviewedAt: true,
            createdAt: true,
            sentAt: true,
            deliveryChannel: true,
            sourceLogIds: true,
            deliveryEvents: {
              select: {
                eventType: true,
                createdAt: true,
                deliveryChannel: true,
              },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        _count: {
          select: { conversations: true, sessions: true, reports: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const studentIds = students.map((s) => s.id);
    const activeLocks =
      studentIds.length === 0
        ? []
        : await prisma.studentRecordingLock.findMany({
            where: {
              studentId: { in: studentIds },
              expiresAt: { gt: now },
            },
            select: {
              studentId: true,
              mode: true,
              lockedBy: { select: { name: true } },
            },
          });
    const lockByStudent = new Map(activeLocks.map((l) => [l.studentId, l]));

    const studentsOut = students.map((s) => ({
      ...s,
      recordingLock: lockByStudent.has(s.id)
        ? {
            mode: lockByStudent.get(s.id)!.mode,
            lockedByName: lockByStudent.get(s.id)!.lockedBy.name,
          }
        : null,
    }));

    return NextResponse.json(
      { students: studentsOut },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (e: any) {
    console.error("[GET /api/students] Error:", {
      error: e?.message,
      stack: e?.stack,
    });
    return NextResponse.json(
      { error: e?.message ?? "Internal Server Error", students: [] },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;

    const body = await request.json();
    const { name, nameKana, grade, course, enrollmentDate, birthdate, guardianNames } = body ?? {};
    if (!name) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }

    const student = await prisma.student.create({
      data: {
        organizationId: authResult.session.user.organizationId,
        name,
        nameKana,
        grade,
        course,
        enrollmentDate: enrollmentDate ? new Date(enrollmentDate) : undefined,
        birthdate: birthdate ? new Date(birthdate) : undefined,
        guardianNames: normalizeGuardianNames(guardianNames),
      },
    });

    return NextResponse.json({ student }, { status: 201 });
  } catch (e: any) {
    if (e instanceof TypeError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[POST /api/students] Error:", {
      error: e?.message,
      stack: e?.stack,
    });
    return NextResponse.json(
      { error: e?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}
