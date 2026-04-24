import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireTeacherAppSessionForRequest } from "@/lib/server/teacher-app-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_LIMIT = 30;

function buildSubtitle(student: { grade: string | null; course: string | null }) {
  return [student.grade, student.course].filter(Boolean).join(" / ") || null;
}

export async function GET(request: Request) {
  try {
    const authResult = await requireTeacherAppSessionForRequest(request);
    if (authResult.response) return authResult.response;

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.trim() ?? "";
    const limitRaw = Number(searchParams.get("limit") ?? DEFAULT_LIMIT);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : DEFAULT_LIMIT;

    const students = await prisma.student.findMany({
      where: {
        organizationId: authResult.session.organizationId,
        archivedAt: null,
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { nameKana: { contains: query, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        nameKana: true,
        grade: true,
        course: true,
      },
      orderBy: [{ name: "asc" }, { createdAt: "asc" }],
      take: limit,
    });

    return NextResponse.json({
      students: students.map((student) => ({
        id: student.id,
        name: student.name,
        subtitle: buildSubtitle(student),
        score: null,
        reason: null,
      })),
    });
  } catch (error: any) {
    console.error("[GET /api/teacher/students] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error", students: [] }, { status: 500 });
  }
}
