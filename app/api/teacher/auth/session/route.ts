import { NextResponse } from "next/server";
import { getTeacherAppSession } from "@/lib/server/teacher-app-session";

export async function GET() {
  const session = await getTeacherAppSession();
  if (!session) {
    return NextResponse.json({ session: null }, { status: 401 });
  }
  return NextResponse.json({ session });
}
