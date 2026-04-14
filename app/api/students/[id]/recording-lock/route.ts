import { NextResponse } from "next/server";
import { RecordingLockMode, UserRole } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { runWithDatabaseRetry } from "@/lib/db-retry";
import {
  createOperationErrorContext,
  logOperationIssue,
  respondWithOperationError,
} from "@/lib/observability/operation-errors";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import {
  acquireRecordingLock,
  forceReleaseRecordingLock,
  getRecordingLockView,
  heartbeatRecordingLock,
  releaseRecordingLock,
} from "@/lib/recording/lockService";
import { maybeEnsureRunpodWorker } from "@/lib/runpod/worker-control";
import { withActiveStudentWhere } from "@/lib/students/student-lifecycle";

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

async function resolveStudentId(params: { id: string } | Promise<{ id: string }>) {
  const resolved = await Promise.resolve(params);
  return typeof resolved?.id === "string" ? resolved.id.trim() : "";
}

async function assertStudentAccess(studentId: string, organizationId: string) {
  const student = await runWithDatabaseRetry("recording-lock-student-access", () =>
    prisma.student.findFirst({
      where: withActiveStudentWhere({ id: studentId, organizationId }),
      select: { id: true, organizationId: true },
    })
  );
  if (!student) {
    return null;
  }
  return student;
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  const context = createOperationErrorContext("recording-lock");
  let stage = "auth";
  try {
    const studentId = await resolveStudentId(params);
    const session = await auth();
    if (!session?.user?.id || !session.user.organizationId) {
      return respondWithOperationError({
        context,
        stage,
        message: "Unauthorized",
        status: 401,
      });
    }
    if (!studentId) {
      return respondWithOperationError({
        context,
        stage: "params",
        message: "生徒IDが必要です。",
        status: 400,
        level: "warn",
      });
    }

    stage = "student_lookup";
    const student = await assertStudentAccess(studentId, session.user.organizationId);
    if (!student) {
      return respondWithOperationError({
        context,
        stage,
        message: "生徒が見つかりません。",
        status: 404,
        level: "warn",
      });
    }

    stage = "view";
    const view = await runWithDatabaseRetry("recording-lock-view", () =>
      getRecordingLockView({
        studentId,
        viewerUserId: session.user.id,
      })
    );
    return NextResponse.json(view);
  } catch (e: any) {
    return respondWithOperationError({
      context,
      stage,
      message: e?.message ?? "Internal Server Error",
      status: 500,
      error: e,
    });
  }
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  const context = createOperationErrorContext("recording-lock");
  let stage = "auth";
  try {
    const studentId = await resolveStudentId(params);
    const session = await auth();
    if (!session?.user?.id || !session.user.organizationId) {
      return respondWithOperationError({
        context,
        stage,
        message: "Unauthorized",
        status: 401,
      });
    }
    if (!studentId) {
      return respondWithOperationError({
        context,
        stage: "params",
        message: "生徒IDが必要です。",
        status: 400,
        level: "warn",
      });
    }

    stage = "student_lookup";
    const student = await assertStudentAccess(studentId, session.user.organizationId);
    if (!student) {
      return respondWithOperationError({
        context,
        stage,
        message: "生徒が見つかりません。",
        status: 404,
        level: "warn",
      });
    }

    const body = await request.json().catch(() => ({}));
    if (body?.forceRelease === true) {
      stage = "force_release";
      if (!canForceReleaseRole(session.user.role)) {
        return respondWithOperationError({
          context,
          stage,
          message: "ロックの強制解除は管理者のみ実行できます。",
          status: 403,
          level: "warn",
        });
      }
      try {
        await runWithDatabaseRetry("recording-lock-force-release", () =>
          forceReleaseRecordingLock({
            studentId,
            actorUserId: session.user.id,
            reason: typeof body?.reason === "string" ? body.reason : undefined,
          })
        );
      } catch (error) {
        const afterReleaseView = await runWithDatabaseRetry("recording-lock-view", () =>
          getRecordingLockView({
            studentId,
            viewerUserId: session.user.id,
          })
        );
        if (afterReleaseView.active) {
          throw error;
        }

        logOperationIssue({
          context,
          stage: "force_release_audit",
          message: "recording lock force release completed but audit log failed",
          error,
          level: "warn",
        });
      }
      stage = "view";
      const view = await runWithDatabaseRetry("recording-lock-view", () =>
        getRecordingLockView({ studentId, viewerUserId: session.user.id })
      );
      return NextResponse.json({ released: true, ...view });
    }

    stage = "validate_mode";
    const mode = parseMode(body?.mode);
    if (!mode) {
      return respondWithOperationError({
        context,
        stage,
        message: "mode は INTERVIEW または LESSON_REPORT を指定してください。",
        status: 400,
        level: "warn",
      });
    }

    stage = "acquire";
    const result = await runWithDatabaseRetry("recording-lock-acquire", () =>
      acquireRecordingLock({
        studentId,
        userId: session.user.id,
        organizationId: session.user.organizationId,
        mode,
      })
    );

    if (!result.ok) {
      logOperationIssue({
        context,
        stage: "acquire_conflict",
        message: result.messageJa,
        level: "warn",
        extra: {
          lockedByUserId: result.lockedByUserId,
          lockedByName: result.lockedByName,
          mode: result.mode,
          expiresAt: result.expiresAt,
        },
      });
      return NextResponse.json(
        {
          error: result.messageJa,
          operationId: context.operationId,
          stage: "acquire_conflict",
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

    if (!shouldRunBackgroundJobsInline() && mode === RecordingLockMode.INTERVIEW) {
      void maybeEnsureRunpodWorker().catch((error) => {
        logOperationIssue({
          context,
          stage: "worker_wake",
          message: "Runpod worker wake failed",
          error,
        });
      });
    }

    return NextResponse.json({
      lockToken: result.lockToken,
      expiresAt: result.expiresAt,
      mode: result.mode,
    });
  } catch (e: any) {
    return respondWithOperationError({
      context,
      stage,
      message: e?.message ?? "Internal Server Error",
      status: 500,
      error: e,
    });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  const context = createOperationErrorContext("recording-lock");
  let stage = "auth";
  try {
    const studentId = await resolveStudentId(params);
    const session = await auth();
    if (!session?.user?.id || !session.user.organizationId) {
      return respondWithOperationError({
        context,
        stage,
        message: "Unauthorized",
        status: 401,
      });
    }
    if (!studentId) {
      return respondWithOperationError({
        context,
        stage: "params",
        message: "生徒IDが必要です。",
        status: 400,
        level: "warn",
      });
    }

    const body = await request.json().catch(() => ({}));
    const lockToken = typeof body?.lockToken === "string" ? body.lockToken.trim() : "";
    if (!lockToken) {
      return respondWithOperationError({
        context,
        stage: "validate_token",
        message: "lockToken が必要です。",
        status: 400,
        level: "warn",
      });
    }

    stage = "heartbeat";
    const beat = await runWithDatabaseRetry("recording-lock-heartbeat", () =>
      heartbeatRecordingLock({
        studentId,
        userId: session.user.id,
        plainToken: lockToken,
      })
    );
    if (!beat.ok) {
      logOperationIssue({
        context,
        stage,
        message: "recording lock heartbeat failed",
        level: "warn",
        extra: { code: beat.code },
      });
      return NextResponse.json({
        ok: false,
        code: beat.code,
        operationId: context.operationId,
        stage,
      });
    }
    return NextResponse.json({ ok: true, expiresAt: beat.expiresAt });
  } catch (e: any) {
    return respondWithOperationError({
      context,
      stage,
      message: e?.message ?? "Internal Server Error",
      status: 500,
      error: e,
    });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  const context = createOperationErrorContext("recording-lock");
  let stage = "auth";
  try {
    const studentId = await resolveStudentId(params);
    const session = await auth();
    if (!session?.user?.id || !session.user.organizationId) {
      return respondWithOperationError({
        context,
        stage,
        message: "Unauthorized",
        status: 401,
      });
    }
    if (!studentId) {
      return respondWithOperationError({
        context,
        stage: "params",
        message: "生徒IDが必要です。",
        status: 400,
        level: "warn",
      });
    }
    let lockToken = "";
    try {
      const body = await request.json();
      lockToken = typeof body?.lockToken === "string" ? body.lockToken.trim() : "";
    } catch {
      lockToken = "";
    }
    if (!lockToken) {
      return respondWithOperationError({
        context,
        stage: "validate_token",
        message: "lockToken が必要です。",
        status: 400,
        level: "warn",
      });
    }

    stage = "release";
    const released = await runWithDatabaseRetry("recording-lock-release", () =>
      releaseRecordingLock({
        studentId,
        userId: session.user.id,
        plainToken: lockToken,
      })
    );
    if (!released.ok) {
      logOperationIssue({
        context,
        stage,
        message: "recording lock release failed",
        level: "warn",
        extra: { code: released.code },
      });
      return NextResponse.json({
        ok: false,
        code: released.code,
        operationId: context.operationId,
        stage,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return respondWithOperationError({
      context,
      stage,
      message: e?.message ?? "Internal Server Error",
      status: 500,
      error: e,
    });
  }
}
