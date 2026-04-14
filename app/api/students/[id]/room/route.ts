import { NextResponse } from "next/server";
import { createOperationContext, operationErrorResponse } from "@/lib/observability/operation-errors";
import { requireAuthorizedSession } from "@/lib/server/request-auth";
import { getStudentRoomData } from "@/lib/students/get-student-room";

export async function GET(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  const operation = createOperationContext("GET /api/students/[id]/room");
  try {
    const { id } = await Promise.resolve(params);
    const studentId = typeof id === "string" ? id.trim() : "";
    if (!studentId) {
      return NextResponse.json({ error: "studentId が必要です。", operationId: operation.operationId, stage: "resolve_params" }, { status: 400 });
    }

    const authResult = await requireAuthorizedSession();
    if (authResult.response) {
      return NextResponse.json({ error: "Unauthorized", operationId: operation.operationId, stage: "authorize" }, { status: 401 });
    }
    const authSession = authResult.session;

    const scope = new URL(request.url).searchParams.get("scope") === "summary" ? "summary" : "full";
    const studentRoom = await getStudentRoomData({
      studentId,
      organizationId: authSession.user.organizationId,
      viewerUserId: authSession.user.id,
      scope,
    });

    if (!studentRoom) {
      return NextResponse.json(
        { error: "生徒が見つかりません。", operationId: operation.operationId, stage: "load_room" },
        { status: 404 }
      );
    }

    return NextResponse.json(studentRoom);
  } catch (error: any) {
    return operationErrorResponse(operation, {
      stage: "load_room",
      message: error?.message ?? "Internal Server Error",
      error,
    });
  }
}
