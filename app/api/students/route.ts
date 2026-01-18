import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
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
  });

  return NextResponse.json({ students });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { organizationId, name, grade, course, enrollmentDate, birthdate, guardianNames } =
    body ?? {};
  if (!organizationId || !name) {
    return NextResponse.json(
      { error: "organizationId and name are required" },
      { status: 400 }
    );
  }

  const student = await prisma.student.create({
    data: {
      organizationId,
      name,
      grade,
      course,
      enrollmentDate: enrollmentDate ? new Date(enrollmentDate) : undefined,
      birthdate: birthdate ? new Date(birthdate) : undefined,
      guardianNames,
    },
  });

  return NextResponse.json({ student }, { status: 201 });
}
