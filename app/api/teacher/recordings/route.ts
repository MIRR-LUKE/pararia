import { NextResponse } from "next/server";
import { applyLightMutationThrottle } from "@/lib/server/request-throttle";
import { requireTeacherAppMutationSession, requireTeacherAppSessionForRequest } from "@/lib/server/teacher-app-session";
import { createTeacherRecordingSession, loadLatestActiveTeacherRecording } from "@/lib/teacher-app/server/recordings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const authResult = await requireTeacherAppSessionForRequest(request);
    if (authResult.response) return authResult.response;

    const activeRecording = await loadLatestActiveTeacherRecording(authResult.session.organizationId, {
      deviceId: authResult.session.deviceId,
      deviceLabel: authResult.session.deviceLabel,
    });
    return NextResponse.json({
      activeRecording,
    });
  } catch (error: any) {
    console.error("[GET /api/teacher/recordings] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const authResult = await requireTeacherAppMutationSession(request);
    if (authResult.response) return authResult.response;

    const throttleResponse = await applyLightMutationThrottle({
      request,
      scope: "teacher.recordings.create",
      userId: authResult.session.userId,
      organizationId: authResult.session.organizationId,
    });
    if (throttleResponse) return throttleResponse;

    const recordingId = await createTeacherRecordingSession(authResult.session);
    return NextResponse.json(
      {
        recordingId,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("[POST /api/teacher/recordings] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
