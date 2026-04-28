import { NextResponse } from "next/server";
import {
  beginIdempotency,
  completeIdempotency,
  failIdempotency,
  IdempotencyConflictError,
} from "@/lib/idempotency";
import { applyLightMutationThrottle } from "@/lib/server/request-throttle";
import { resolveRouteId, type RouteParams } from "@/lib/server/route-params";
import { requireNativeTeacherAppMutationSession } from "@/lib/server/teacher-app-session";
import { TeacherRecordingStatusTransitionError } from "@/lib/teacher-app/server/recording-status";
import { confirmTeacherRecordingStudent } from "@/lib/teacher-app/server/recordings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request, { params }: { params: RouteParams }) {
  let idempotencyKey: string | null = null;
  let idempotencyStarted = false;

  try {
    const authResult = await requireNativeTeacherAppMutationSession(request);
    if (authResult.response) return authResult.response;

    const throttleResponse = await applyLightMutationThrottle({
      request,
      scope: "teacher.recordings.confirm",
      userId: authResult.session.userId,
      organizationId: authResult.session.organizationId,
    });
    if (throttleResponse) return throttleResponse;

    const recordingId = await resolveRouteId(params);
    if (!recordingId) {
      return NextResponse.json({ error: "recordingId が必要です。" }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as { studentId?: string | null } | null;
    const studentId = typeof body?.studentId === "string" && body.studentId.trim() ? body.studentId.trim() : null;
    idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || `${recordingId}:${studentId ?? "none"}`;
    const requestBody = {
      recordingId,
      studentId,
      deviceId: authResult.session.deviceId,
    };
    const idempotency = await beginIdempotency({
      scope: "teacher_recording_confirm",
      idempotencyKey,
      requestBody,
      organizationId: authResult.session.organizationId,
      userId: authResult.session.userId,
      ttlMs: 24 * 60 * 60 * 1000,
    });
    if (idempotency.state === "completed") {
      return NextResponse.json(idempotency.responseBody ?? {}, { status: idempotency.responseStatus ?? 200 });
    }
    if (idempotency.state === "pending") {
      return NextResponse.json(
        { error: "同じ生徒確定リクエストがまだ進行中です。少し待ってから再読み込みしてください。" },
        { status: 409 }
      );
    }
    idempotencyStarted = true;

    const result = await confirmTeacherRecordingStudent({
      organizationId: authResult.session.organizationId,
      deviceId: authResult.session.deviceId,
      deviceLabel: authResult.session.deviceLabel,
      recordingId,
      studentId,
    });

    const responseBody = {
      ok: true,
      result,
    };
    await completeIdempotency({
      scope: "teacher_recording_confirm",
      idempotencyKey,
      responseStatus: 200,
      responseBody,
    });
    return NextResponse.json(responseBody);
  } catch (error: any) {
    if (error instanceof IdempotencyConflictError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof TeacherRecordingStatusTransitionError) {
      if (idempotencyStarted && idempotencyKey) {
        await failIdempotency({
          scope: "teacher_recording_confirm",
          idempotencyKey,
        }).catch(() => {});
      }
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (idempotencyStarted && idempotencyKey) {
      await failIdempotency({
        scope: "teacher_recording_confirm",
        idempotencyKey,
      }).catch(() => {});
    }
    console.error("[POST /api/teacher/recordings/[id]/confirm] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
