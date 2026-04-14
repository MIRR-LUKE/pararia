import { createHash, randomBytes } from "crypto";
import { Prisma, RecordingLockMode } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { RECORDING_LOCK_TTL_MS } from "@/lib/recording/lockConstants";

export { RECORDING_LOCK_HEARTBEAT_MS, RECORDING_LOCK_TTL_MS } from "@/lib/recording/lockConstants";

export function hashRecordingLockToken(plainToken: string) {
  return createHash("sha256").update(plainToken, "utf8").digest("hex");
}

export function generateRecordingLockToken() {
  return randomBytes(32).toString("hex");
}

function computeExpiresAt(from: Date = new Date()) {
  return new Date(from.getTime() + RECORDING_LOCK_TTL_MS);
}

function requireStudentId(studentId: string | null | undefined) {
  const normalized = typeof studentId === "string" ? studentId.trim() : "";
  if (!normalized) {
    throw new Error("studentId is required");
  }
  return normalized;
}

export async function pruneExpiredRecordingLock(studentId: string) {
  const resolvedStudentId = requireStudentId(studentId);
  const now = new Date();
  const row = await prisma.studentRecordingLock.findUnique({
    where: { studentId: resolvedStudentId },
  });
  if (row && row.expiresAt <= now) {
    await prisma.studentRecordingLock.deleteMany({ where: { studentId: resolvedStudentId } });
  }
}

export async function getRecordingLockView(opts: {
  studentId: string;
  viewerUserId?: string | null;
}) {
  const resolvedStudentId = requireStudentId(opts.studentId);
  const row = await prisma.studentRecordingLock.findUnique({
    where: { studentId: resolvedStudentId },
    include: {
      lockedBy: { select: { id: true, name: true, email: true } },
    },
  });
  if (!row) return { active: false as const, lock: null };

  const now = new Date();
  if (row.expiresAt <= now) {
    await prisma.studentRecordingLock.deleteMany({ where: { studentId: resolvedStudentId } });
    return { active: false as const, lock: null };
  }

  return {
    active: true as const,
    lock: {
      lockedByUserId: row.lockedByUserId,
      lockedByName: row.lockedBy.name,
      lockedByEmail: row.lockedBy.email,
      mode: row.mode,
      expiresAt: row.expiresAt.toISOString(),
      isHeldByViewer: opts.viewerUserId ? row.lockedByUserId === opts.viewerUserId : false,
    },
  };
}

export type AcquireRecordingLockResult =
  | { ok: true; lockToken: string; expiresAt: string; mode: RecordingLockMode }
  | {
      ok: false;
      code: "conflict";
      messageJa: string;
      lockedByUserId: string;
      lockedByName: string;
      mode: RecordingLockMode;
      expiresAt: string;
    };

export async function acquireRecordingLock(opts: {
  studentId: string;
  userId: string;
  organizationId: string;
  mode: RecordingLockMode;
}): Promise<AcquireRecordingLockResult> {
  const resolvedStudentId = requireStudentId(opts.studentId);
  const now = new Date();
  const plainToken = generateRecordingLockToken();
  const tokenHash = hashRecordingLockToken(plainToken);
  const expiresAt = computeExpiresAt(now);
  const buildSuccess = () => ({
    ok: true as const,
    lockToken: plainToken,
    expiresAt: expiresAt.toISOString(),
    mode: opts.mode,
  });
  const buildConflict = (existing: {
    lockedByUserId: string;
    lockedBy: { name: string };
    mode: RecordingLockMode;
    expiresAt: Date;
  }) => ({
    ok: false as const,
    code: "conflict" as const,
    messageJa: `${existing.lockedBy.name} さんが録音中です。しばらくお待ちになるか、管理者にロック解除を依頼してください。`,
    lockedByUserId: existing.lockedByUserId,
    lockedByName: existing.lockedBy.name,
    mode: existing.mode,
    expiresAt: existing.expiresAt.toISOString(),
  });
  const isUniqueConstraintError = (error: unknown) =>
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existing = await prisma.studentRecordingLock.findUnique({
      where: { studentId: resolvedStudentId },
      include: { lockedBy: { select: { name: true } } },
    });

    if (existing) {
      if (existing.expiresAt > now && existing.lockedByUserId !== opts.userId) {
        return buildConflict(existing);
      }

      if (existing.expiresAt <= now) {
        await prisma.studentRecordingLock.deleteMany({
          where: {
            studentId: resolvedStudentId,
            expiresAt: { lte: now },
          },
        });
        continue;
      }

      const updated = await prisma.studentRecordingLock.updateMany({
        where: {
          studentId: resolvedStudentId,
          lockedByUserId: opts.userId,
        },
        data: {
          organizationId: opts.organizationId,
          lockedByUserId: opts.userId,
          lockTokenHash: tokenHash,
          mode: opts.mode,
          lastHeartbeatAt: now,
          expiresAt,
        },
      });

      if (updated.count > 0) {
        return buildSuccess();
      }

      continue;
    }

    try {
      await prisma.studentRecordingLock.create({
        data: {
          studentId: resolvedStudentId,
          organizationId: opts.organizationId,
          lockedByUserId: opts.userId,
          lockTokenHash: tokenHash,
          mode: opts.mode,
          lastHeartbeatAt: now,
          expiresAt,
        },
      });
      return buildSuccess();
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        continue;
      }
      throw error;
    }
  }

  const finalExisting = await prisma.studentRecordingLock.findUnique({
    where: { studentId: resolvedStudentId },
    include: { lockedBy: { select: { name: true } } },
  });

  if (finalExisting && finalExisting.expiresAt > now && finalExisting.lockedByUserId !== opts.userId) {
    return buildConflict(finalExisting);
  }

  throw new Error("録音ロックの取得に失敗しました。少し待ってからもう一度お試しください。");
}

export async function heartbeatRecordingLock(opts: {
  studentId: string;
  userId: string;
  plainToken: string;
}) {
  const resolvedStudentId = requireStudentId(opts.studentId);
  const now = new Date();
  const hash = hashRecordingLockToken(opts.plainToken);
  const row = await prisma.studentRecordingLock.findUnique({
    where: { studentId: resolvedStudentId },
  });
  if (!row || row.expiresAt <= now) {
    await prisma.studentRecordingLock.deleteMany({ where: { studentId: resolvedStudentId } });
    return { ok: false as const, code: "stale_or_missing" as const };
  }
  if (row.lockedByUserId !== opts.userId || row.lockTokenHash !== hash) {
    return { ok: false as const, code: "token_mismatch" as const };
  }
  const nextExpires = computeExpiresAt(now);
  await prisma.studentRecordingLock.update({
    where: { studentId: resolvedStudentId },
    data: { lastHeartbeatAt: now, expiresAt: nextExpires },
  });
  return { ok: true as const, expiresAt: nextExpires.toISOString() };
}

export async function releaseRecordingLock(opts: {
  studentId: string;
  userId: string;
  plainToken: string;
}) {
  const resolvedStudentId = requireStudentId(opts.studentId);
  const now = new Date();
  const hash = hashRecordingLockToken(opts.plainToken);
  const row = await prisma.studentRecordingLock.findUnique({
    where: { studentId: resolvedStudentId },
  });
  if (!row) return { ok: true as const };
  if (row.expiresAt <= now) {
    await prisma.studentRecordingLock.deleteMany({ where: { studentId: resolvedStudentId } });
    return { ok: true as const };
  }
  if (row.lockedByUserId !== opts.userId || row.lockTokenHash !== hash) {
    return { ok: false as const, code: "token_mismatch" as const };
  }
  await prisma.studentRecordingLock.deleteMany({ where: { studentId: resolvedStudentId } });
  return { ok: true as const };
}

export async function verifyRecordingLockForAudioUpload(opts: {
  studentId: string;
  userId: string;
  plainToken: string;
}) {
  const resolvedStudentId = requireStudentId(opts.studentId);
  const now = new Date();
  const hash = hashRecordingLockToken(opts.plainToken);
  const row = await prisma.studentRecordingLock.findUnique({
    where: { studentId: resolvedStudentId },
  });
  if (!row || row.expiresAt <= now) {
    return false;
  }
  return row.lockedByUserId === opts.userId && row.lockTokenHash === hash;
}

export async function forceReleaseRecordingLock(opts: {
  studentId: string;
  actorUserId: string;
  reason?: string;
}) {
  await prisma.studentRecordingLock.deleteMany({ where: { studentId: opts.studentId } });
  await writeAuditLog({
    userId: opts.actorUserId,
    action: "recording_lock_force_release",
    detail: {
      studentId: opts.studentId,
      reason: opts.reason ?? null,
    },
  });
}
