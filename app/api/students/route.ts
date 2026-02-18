import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureOrganizationId } from "@/lib/server/organization";

export async function GET() {
  try {
    const students = await prisma.student.findMany({
      include: {
        profiles: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        conversations: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        _count: {
          select: { conversations: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ students });
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
