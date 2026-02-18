import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureOrganizationId } from "@/lib/server/organization";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    const limitRaw = searchParams.get("limit");
    const limit = limitRaw ? Math.max(1, Math.min(200, Number(limitRaw))) : undefined;

    const students = await prisma.student.findMany({
      where: {
        ...(organizationId ? { organizationId } : {}),
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
        _count: {
          select: { conversations: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(
      { students },
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
  const body = await request.json();
  const { organizationId, name, nameKana, grade, course, enrollmentDate, birthdate, guardianNames } = body ?? {};
  if (!name) {
    return NextResponse.json(
      { error: "name is required" },
      { status: 400 }
    );
  }
  const resolvedOrgId = await ensureOrganizationId(organizationId);

  const student = await prisma.student.create({
    data: {
      organizationId: resolvedOrgId,
      name,
      nameKana,
      grade,
      course,
      enrollmentDate: enrollmentDate ? new Date(enrollmentDate) : undefined,
      birthdate: birthdate ? new Date(birthdate) : undefined,
      guardianNames,
    },
  });

  return NextResponse.json({ student }, { status: 201 });
}
