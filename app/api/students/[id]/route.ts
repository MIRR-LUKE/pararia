import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const student = await prisma.student.findUnique({
    where: { id: params.id },
    include: {
      profiles: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      conversations: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      reports: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });

  if (!student) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({ student });
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  const body = await request.json();
  const { name, grade, course, guardianNames, enrollmentDate, birthdate } = body ?? {};

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (grade !== undefined) data.grade = grade;
  if (course !== undefined) data.course = course;
  if (guardianNames !== undefined) data.guardianNames = guardianNames;
  if (enrollmentDate !== undefined)
    data.enrollmentDate = enrollmentDate ? new Date(enrollmentDate) : null;
  if (birthdate !== undefined) data.birthdate = birthdate ? new Date(birthdate) : null;

  const student = await prisma.student.update({
    where: { id: params.id },
    data,
  });

  return NextResponse.json({ student });
}
