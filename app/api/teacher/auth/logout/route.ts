import { NextResponse } from "next/server";
import { buildTeacherAppSessionCookieClear } from "@/lib/teacher-app/device-auth";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(buildTeacherAppSessionCookieClear());
  return response;
}
