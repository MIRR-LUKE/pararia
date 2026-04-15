import { ConversationStatus, JobStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { JOB_LEASE_MS } from "./shared";
import type { JobPayload } from "./types";

export function isConversationProcessingLeaseActive(input: {
  status: ConversationStatus | string | null | undefined;
  processingLeaseExecutionId: string | null | undefined;
  processingLeaseExpiresAt: Date | string | null | undefined;
  now?: Date;
}) {
  if (input.status !== ConversationStatus.PROCESSING) return false;
  if (!input.processingLeaseExecutionId) return false;
  if (!input.processingLeaseExpiresAt) return false;
  const now = input.now ?? new Date();
  const expiresAt =
    input.processingLeaseExpiresAt instanceof Date
      ? input.processingLeaseExpiresAt
      : new Date(input.processingLeaseExpiresAt);
  if (Number.isNaN(expiresAt.getTime())) return false;
  return expiresAt.getTime() > now.getTime();
}

export async function acquireConversationProcessingLease(opts: {
  conversationId: string;
  executionId: string;
}) {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + JOB_LEASE_MS);
  const updated = await prisma.conversationLog.updateMany({
    where: {
      id: opts.conversationId,
      status: ConversationStatus.PROCESSING,
      deletedAt: null,
      OR: [
        { processingLeaseExecutionId: null },
        { processingLeaseExpiresAt: null },
        { processingLeaseExpiresAt: { lte: now } },
        { processingLeaseExecutionId: opts.executionId },
      ],
    },
    data: {
      processingLeaseExecutionId: opts.executionId,
      processingLeaseStartedAt: now,
      processingLeaseHeartbeatAt: now,
      processingLeaseExpiresAt: leaseExpiresAt,
    },
  });

  if (updated.count !== 1) {
    return { acquired: false as const };
  }

  return {
    acquired: true as const,
    executionId: opts.executionId,
    leaseExpiresAt,
    startedAt: now,
  };
}

export async function touchConversationProcessingLease(opts: {
  conversationId: string;
  executionId: string;
}) {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + JOB_LEASE_MS);
  await prisma.conversationLog.updateMany({
    where: {
      id: opts.conversationId,
      processingLeaseExecutionId: opts.executionId,
      status: ConversationStatus.PROCESSING,
      deletedAt: null,
    },
    data: {
      processingLeaseHeartbeatAt: now,
      processingLeaseExpiresAt: leaseExpiresAt,
    },
  });
}

export async function releaseConversationProcessingLease(opts: {
  conversationId: string;
  executionId: string;
}) {
  await prisma.conversationLog.updateMany({
    where: {
      id: opts.conversationId,
      processingLeaseExecutionId: opts.executionId,
      deletedAt: null,
    },
    data: {
      processingLeaseExecutionId: null,
      processingLeaseExpiresAt: null,
      processingLeaseStartedAt: null,
      processingLeaseHeartbeatAt: null,
    },
  });
}

export async function touchJobLease(job: JobPayload) {
  const now = new Date();
  await prisma.conversationJob.updateMany({
    where: {
      id: job.id,
      status: JobStatus.RUNNING,
      executionId: job.executionId,
    },
    data: {
      lastHeartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + JOB_LEASE_MS),
    },
  });
  await touchConversationProcessingLease({
    conversationId: job.conversationId,
    executionId: job.executionId,
  });
}
