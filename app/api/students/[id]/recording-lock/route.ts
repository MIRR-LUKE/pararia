import { NextResponse } from "next/server";
import { RecordingLockMode, UserRole } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  acquireRecordingLock,
  forceReleaseRecordingLock,
  getRecordingLockView,
  heartbeatRecordingLock,
  releaseRecordingLock,
} from "@/lib/recording/lockService";

export const dynamic = "force-dynamic";

function parseMode(raw: unknown): RecordingLockMode | null {
  if (raw === RecordingLockMode.LESSON_REPORT) return RecordingLockMode.LESSON_REPORT;
  if (raw === RecordingLockMode.INTERVIEW) return RecordingLockMode.INTERVIEW;
  if (raw === "LESSON_REPORT") return RecordingLockMode.LESSON_REPORT;
  if (raw === "INTERVIEW") return RecordingLockMode.INTERVIEW;
  return null;
}

function canForceReleaseRole(role: string | undefined) {
  return role === UserRole.ADMIN || role === UserRole.MANAGER;
}

async function assertStudentAccess(studentId: string, organizationId: string) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, organizationId: true },
  });
  if (!student || student.organizationId !== organizationId) {
    return null;
  }
  return student;
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.organizationId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const student = await assertStudentAccess(params.id, session.user.organizationId);
    if (!student) {
      return NextResponse.json({ error: "生徒が見つかりません。" }, { status: 404 });
    }

    const view = await getRecordingLockView({
      studentId: params.id,
      viewerUserId: session.user.id,
    });
    return NextResponse.json(view);
  } catch (e: any) {
    console.error("[GET recording-lock]", e);
    return NextResponse.json({ error: e?.message ?? "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.organizationId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const student = await assertStudentAccess(params.id, session.user.organizationId);
    if (!student) {
      return NextResponse.json({ error: "生徒が見つかりません。" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    if (body?.forceRelease === true) {
      if (!canForceReleaseRole(session.user.role)) {
        return NextResponse.json({ error: "ロックの強制解除は管理者のみ実行できます。" }, { status: 403 });
      }
      await forceReleaseRecordingLock({
        studentId: params.id,
        actorUserId: session.user.id,
        reason: typeof body?.reason === "string" ? body.reason : undefined,
      });
      const view = await getRecordingLockView({ studentId: params.id, viewerUserId: session.user.id });
      return NextResponse.json({ released: true, ...view });
    }

    const mode = parseMode(body?.mode);
    if (!mode) {
      return NextResponse.json({ error: "mode は INTERVIEW または LESSON_REPORT を指定してください。" }, { status: 400 });
    }

    const result = await acquireRecordingLock({
      studentId: params.id,
      userId: session.user.id,
      organizationId: session.user.organizationId,
      mode,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.messageJa,
          code: "recording_lock_conflict",
          lockedBy: {
            userId: result.lockedByUserId,
            name: result.lockedByName,
          },
          mode: result.mode,
          expiresAt: result.expiresAt,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      lockToken: result.lockToken,
      expiresAt: result.expiresAt,
      mode: result.mode,
    });
  } catch (e: any) {
    console.error("[POST recording-lock]", e);
    return NextResponse.json({ error: e?.message ?? "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.organizationId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const student = await assertStudentAccess(params.id, session.user.organizationId);
    if (!student) {
      return NextResponse.json({ error: "生徒が見つかりません。" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const lockToken = typeof body?.lockToken === "string" ? body.lockToken.trim() : "";
    if (!lockToken) {
      return NextResponse.json({ error: "lockToken が必要です。" }, { status: 400 });
    }

    const beat = await heartbeatRecordingLock({
      studentId: params.id,
      userId: session.user.id,
      plainToken: lockToken,
    });
    if (!beat.ok) {
      return NextResponse.json({ ok: false, code: beat.code }, { status: 200 });
    }
    return NextResponse.json({ ok: true, expiresAt: beat.expiresAt });
  } catch (e: any) {
    console.error("[PATCH recording-lock]", e);
    return NextResponse.json({ error: e?.message ?? "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.organizationId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const student = await assertStudentAccess(params.id, session.user.organizationId);
    if (!student) {
      return NextResponse.json({ error: "生徒が見つかりません。" }, { status: 404 });
    }

    let lockToken = "";
    try {
      const body = await request.json();
      lockToken = typeof body?.lockToken === "string" ? body.lockToken.trim() : "";
    } catch {
      lockToken = "";
    }
    if (!lockToken) {
      return NextResponse.json({ error: "lockToken が必要です。" }, { status: 400 });
    }

    const released = await releaseRecordingLock({
      studentId: params.id,
      userId: session.user.id,
      plainToken: lockToken,
    });
    if (!released.ok) {
      return NextResponse.json({ ok: false, code: released.code }, { status: 200 });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[DELETE recording-lock]", e);
    return NextResponse.json({ error: e?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
