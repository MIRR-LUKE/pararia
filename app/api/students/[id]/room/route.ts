import { NextResponse } from "next/server";
import { requireAuthorizedSession } from "@/lib/server/request-auth";
import {
  createOperationErrorContext,
  respondWithOperationError,
} from "@/lib/observability/operation-errors";
import { getStudentRoomData } from "@/lib/students/get-student-room";

export async function GET(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  const context = createOperationErrorContext("student-room");
  let stage = "auth";
  try {
    const { id } = await Promise.resolve(params);
    const authResult = await requireAuthorizedSession();
    if (authResult.response) {
      return respondWithOperationError({
        context,
        stage,
        message: "Unauthorized",
        status: 401,
        reason: "unauthorized",
      });
    }
    const authSession = authResult.session;
    const studentId = typeof id === "string" ? id.trim() : "";
    if (!studentId) {
      return respondWithOperationError({
        context,
        stage: "params",
        message: "生徒IDが必要です。",
        status: 400,
        level: "warn",
        reason: "missing_student_id",
      });
    }

    stage = "room_load";
    const scope = new URL(request.url).searchParams.get("scope") === "summary" ? "summary" : "full";
    const studentRoom = await getStudentRoomData({
      studentId,
      organizationId: authSession.user.organizationId,
      viewerUserId: authSession.user.id,
      scope,
    });

    if (!studentRoom) {
      return respondWithOperationError({
        context,
        stage: "student_lookup",
        message: "生徒が見つかりません。",
        status: 404,
        level: "warn",
        reason: "student_not_found",
      });
    }

    return NextResponse.json(studentRoom);
  } catch (error: any) {
    return respondWithOperationError({
      context,
      stage,
      message: error?.message ?? "Internal Server Error",
      status: 500,
      error,
      reason: "unexpected_error",
    });
  }
}
