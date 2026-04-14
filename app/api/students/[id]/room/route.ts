import { NextResponse } from "next/server";
import { requireAuthorizedSession } from "@/lib/server/request-auth";
import { getStudentRoomData } from "@/lib/students/get-student-room";

export async function GET(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const { id } = await Promise.resolve(params);
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    const authSession = authResult.session;

    const scope = new URL(request.url).searchParams.get("scope") === "summary" ? "summary" : "full";
    const studentRoom = await getStudentRoomData({
      studentId: id,
      organizationId: authSession.user.organizationId,
      viewerUserId: authSession.user.id,
      scope,
    });

    if (!studentRoom) {
      return NextResponse.json({ error: "student not found" }, { status: 404 });
    }

    return NextResponse.json(studentRoom);
  } catch (error: any) {
    console.error("[GET /api/students/[id]/room] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
