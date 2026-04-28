import { prisma } from "@/lib/db";

const TEACHER_RECORDING_LEASE_MS = 30 * 60 * 1000;

export async function acquireTeacherRecordingLease(recordingId: string, executionId: string) {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + TEACHER_RECORDING_LEASE_MS);
  const claimed = await prisma.teacherRecordingSession.updateMany({
    where: {
      id: recordingId,
      OR: [
        { processingLeaseExecutionId: null },
        { processingLeaseExpiresAt: null },
        { processingLeaseExpiresAt: { lt: now } },
        { processingLeaseExecutionId: executionId },
      ],
    },
    data: {
      processingLeaseExecutionId: executionId,
      processingLeaseStartedAt: now,
      processingLeaseHeartbeatAt: now,
      processingLeaseExpiresAt: leaseExpiresAt,
    },
  });
  return claimed.count > 0;
}

export async function renewTeacherRecordingLease(recordingId: string, executionId: string) {
  await prisma.teacherRecordingSession.updateMany({
    where: {
      id: recordingId,
      processingLeaseExecutionId: executionId,
    },
    data: {
      processingLeaseHeartbeatAt: new Date(),
      processingLeaseExpiresAt: new Date(Date.now() + TEACHER_RECORDING_LEASE_MS),
    },
  });
}

export async function releaseTeacherRecordingLease(recordingId: string, executionId: string) {
  await prisma.teacherRecordingSession.updateMany({
    where: {
      id: recordingId,
      processingLeaseExecutionId: executionId,
    },
    data: {
      processingLeaseExecutionId: null,
      processingLeaseStartedAt: null,
      processingLeaseHeartbeatAt: null,
      processingLeaseExpiresAt: null,
    },
  });
}
