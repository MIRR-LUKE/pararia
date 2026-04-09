import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuthorizedSession } from "@/lib/server/request-auth";
import { listStudentRows } from "@/lib/students/list-student-rows";

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
    const includeRecordingLock = /^(1|true|yes)$/i.test(searchParams.get("includeRecordingLock") ?? "");
    const studentsOut = await listStudentRows({
      organizationId,
      limit: limit && Number.isFinite(limit) ? Math.floor(limit) : undefined,
      includeRecordingLock,
    });

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

    revalidateTag(`student-directory:${authResult.session.user.organizationId}`);
    revalidateTag(`dashboard-snapshot:${authResult.session.user.organizationId}`);
    revalidatePath("/app/students");
    revalidatePath("/app/dashboard");
    revalidatePath("/app/reports");
    revalidatePath("/app/settings");

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
