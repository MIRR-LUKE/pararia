import { createHash, randomBytes } from "crypto";
import { RecordingLockMode } from "@prisma/client";
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

export async function pruneExpiredRecordingLock(studentId: string) {
  const now = new Date();
  const row = await prisma.studentRecordingLock.findUnique({
    where: { studentId },
  });
  if (row && row.expiresAt <= now) {
    await prisma.studentRecordingLock.delete({ where: { studentId } }).catch(() => {});
  }
}

export async function getRecordingLockView(opts: {
  studentId: string;
  viewerUserId?: string | null;
}) {
  await pruneExpiredRecordingLock(opts.studentId);
  const row = await prisma.studentRecordingLock.findUnique({
    where: { studentId: opts.studentId },
    include: {
      lockedBy: { select: { id: true, name: true, email: true } },
    },
  });
  if (!row) return { active: false as const, lock: null };

  const now = new Date();
  if (row.expiresAt <= now) {
    await prisma.studentRecordingLock.delete({ where: { studentId: opts.studentId } }).catch(() => {});
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
  const student = await prisma.student.findUnique({
    where: { id: opts.studentId },
    select: { id: true, organizationId: true },
  });
  if (!student || student.organizationId !== opts.organizationId) {
    throw new Error("student not found or organization mismatch");
  }

  const now = new Date();
  const plainToken = generateRecordingLockToken();
  const tokenHash = hashRecordingLockToken(plainToken);
  const expiresAt = computeExpiresAt(now);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.studentRecordingLock.findUnique({
      where: { studentId: opts.studentId },
      include: { lockedBy: { select: { name: true } } },
    });

    if (existing && existing.expiresAt > now) {
      if (existing.lockedByUserId !== opts.userId) {
        return {
          ok: false as const,
          code: "conflict" as const,
          messageJa: `${existing.lockedBy.name} さんが録音中です。しばらくお待ちになるか、管理者にロック解除を依頼してください。`,
          lockedByUserId: existing.lockedByUserId,
          lockedByName: existing.lockedBy.name,
          mode: existing.mode,
          expiresAt: existing.expiresAt.toISOString(),
        };
      }
    }

    await tx.studentRecordingLock.upsert({
      where: { studentId: opts.studentId },
      create: {
        studentId: opts.studentId,
        organizationId: student.organizationId,
        lockedByUserId: opts.userId,
        lockTokenHash: tokenHash,
        mode: opts.mode,
        lastHeartbeatAt: now,
        expiresAt,
      },
      update: {
        lockedByUserId: opts.userId,
        lockTokenHash: tokenHash,
        organizationId: student.organizationId,
        mode: opts.mode,
        lastHeartbeatAt: now,
        expiresAt,
      },
    });

    return {
      ok: true as const,
      lockToken: plainToken,
      expiresAt: expiresAt.toISOString(),
      mode: opts.mode,
    };
  });

  return result;
}

export async function heartbeatRecordingLock(opts: {
  studentId: string;
  userId: string;
  plainToken: string;
}) {
  const now = new Date();
  const hash = hashRecordingLockToken(opts.plainToken);
  const row = await prisma.studentRecordingLock.findUnique({
    where: { studentId: opts.studentId },
  });
  if (!row || row.expiresAt <= now) {
    await prisma.studentRecordingLock
      .delete({ where: { studentId: opts.studentId } })
      .catch(() => {});
    return { ok: false as const, code: "stale_or_missing" as const };
  }
  if (row.lockedByUserId !== opts.userId || row.lockTokenHash !== hash) {
    return { ok: false as const, code: "token_mismatch" as const };
  }
  const nextExpires = computeExpiresAt(now);
  await prisma.studentRecordingLock.update({
    where: { studentId: opts.studentId },
    data: { lastHeartbeatAt: now, expiresAt: nextExpires },
  });
  return { ok: true as const, expiresAt: nextExpires.toISOString() };
}

export async function releaseRecordingLock(opts: {
  studentId: string;
  userId: string;
  plainToken: string;
}) {
  const now = new Date();
  const hash = hashRecordingLockToken(opts.plainToken);
  const row = await prisma.studentRecordingLock.findUnique({
    where: { studentId: opts.studentId },
  });
  if (!row) return { ok: true as const };
  if (row.expiresAt <= now) {
    await prisma.studentRecordingLock.delete({ where: { studentId: opts.studentId } }).catch(() => {});
    return { ok: true as const };
  }
  if (row.lockedByUserId !== opts.userId || row.lockTokenHash !== hash) {
    return { ok: false as const, code: "token_mismatch" as const };
  }
  await prisma.studentRecordingLock.delete({ where: { studentId: opts.studentId } });
  return { ok: true as const };
}

export async function verifyRecordingLockForAudioUpload(opts: {
  studentId: string;
  userId: string;
  plainToken: string;
}) {
  const now = new Date();
  const hash = hashRecordingLockToken(opts.plainToken);
  const row = await prisma.studentRecordingLock.findUnique({
    where: { studentId: opts.studentId },
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
  await prisma.studentRecordingLock
    .delete({ where: { studentId: opts.studentId } })
    .catch(() => {});
  await prisma.auditLog.create({
    data: {
      userId: opts.actorUserId,
      action: `recording_lock_force_release:${opts.studentId}:${opts.reason ?? ""}`.slice(0, 500),
    },
  });
}
