import { JobStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

export const STALE_THRESHOLD_MINUTES = 15;

export type CampusMetrics = {
  archivedStudentCount: number;
  queuedJobCount: number;
  runningJobCount: number;
  staleJobCount: number;
  failedJobCount: number;
  lastActivityAt: Date | null;
};

type JobMetric = {
  organizationId: string | null;
  queued: number;
  running: number;
  stale: number;
  failed: number;
};

function maxDate(...values: Array<Date | null | undefined>) {
  return values.reduce<Date | null>((latest, value) => {
    if (!value) return latest;
    if (!latest || value.getTime() > latest.getTime()) return value;
    return latest;
  }, null);
}

export function createEmptyMetrics(): CampusMetrics {
  return {
    archivedStudentCount: 0,
    queuedJobCount: 0,
    runningJobCount: 0,
    staleJobCount: 0,
    failedJobCount: 0,
    lastActivityAt: null,
  };
}

function ensureCampusMetric(map: Map<string, CampusMetrics>, organizationId: string) {
  const existing = map.get(organizationId);
  if (existing) return existing;
  const created = createEmptyMetrics();
  map.set(organizationId, created);
  return created;
}

function applyJobMetric(map: Map<string, CampusMetrics>, metric: JobMetric) {
  if (!metric.organizationId) return;
  const campus = ensureCampusMetric(map, metric.organizationId);
  campus.queuedJobCount += metric.queued;
  campus.runningJobCount += metric.running;
  campus.staleJobCount += metric.stale;
  campus.failedJobCount += metric.failed;
}

function isRunningStale(input: {
  startedAt?: Date | null;
  leaseExpiresAt?: Date | null;
  processingLeaseExpiresAt?: Date | null;
  now: Date;
  staleCutoff: Date;
}) {
  if (input.leaseExpiresAt && input.leaseExpiresAt.getTime() <= input.now.getTime()) return true;
  if (input.processingLeaseExpiresAt && input.processingLeaseExpiresAt.getTime() <= input.now.getTime()) return true;
  return Boolean(input.startedAt && input.startedAt.getTime() <= input.staleCutoff.getTime());
}

export async function getCampusMetrics(organizationIds: string[], now: Date) {
  const metrics = new Map<string, CampusMetrics>();
  for (const id of organizationIds) metrics.set(id, createEmptyMetrics());
  if (organizationIds.length === 0) return metrics;

  const staleCutoff = new Date(now.getTime() - STALE_THRESHOLD_MINUTES * 60 * 1000);

  const archivedStudents = await prisma.student.groupBy({
    by: ["organizationId"],
    where: { organizationId: { in: organizationIds }, archivedAt: { not: null } },
    _count: { _all: true },
  });
  const sessionActivity = await prisma.session.groupBy({
    by: ["organizationId"],
    where: { organizationId: { in: organizationIds } },
    _max: { updatedAt: true, sessionDate: true },
  });
  const conversationActivity = await prisma.conversationLog.groupBy({
    by: ["organizationId"],
    where: { organizationId: { in: organizationIds } },
    _max: { createdAt: true },
  });
  const teacherRecordingActivity = await prisma.teacherRecordingSession.groupBy({
    by: ["organizationId"],
    where: { organizationId: { in: organizationIds } },
    _max: { updatedAt: true, recordedAt: true, uploadedAt: true },
  });
  const conversationJobs = await prisma.conversationJob.findMany({
    where: {
      status: { in: [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.ERROR] },
      conversation: { organizationId: { in: organizationIds } },
    },
    select: {
      status: true,
      startedAt: true,
      leaseExpiresAt: true,
      conversation: { select: { organizationId: true } },
    },
  });
  const sessionPartJobs = await prisma.sessionPartJob.findMany({
    where: {
      status: { in: [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.ERROR] },
      sessionPart: { session: { organizationId: { in: organizationIds } } },
    },
    select: {
      status: true,
      startedAt: true,
      sessionPart: { select: { session: { select: { organizationId: true } } } },
    },
  });
  const teacherRecordingJobs = await prisma.teacherRecordingJob.findMany({
    where: {
      organizationId: { in: organizationIds },
      status: { in: [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.ERROR] },
    },
    select: {
      organizationId: true,
      status: true,
      startedAt: true,
      recordingSession: { select: { processingLeaseExpiresAt: true } },
    },
  });
  const storageDeletionRequests = await prisma.storageDeletionRequest.findMany({
    where: {
      organizationId: { in: organizationIds },
      status: { in: ["PENDING", "RUNNING", "ERROR"] },
    },
    select: {
      organizationId: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  const failedDeliveryEvents = await prisma.reportDeliveryEvent.groupBy({
    by: ["organizationId"],
    where: {
      organizationId: { in: organizationIds },
      eventType: { in: ["FAILED", "BOUNCED"] },
    },
    _count: { _all: true },
  });

  for (const row of archivedStudents) {
    ensureCampusMetric(metrics, row.organizationId).archivedStudentCount = row._count._all;
  }
  for (const row of sessionActivity) {
    const campus = ensureCampusMetric(metrics, row.organizationId);
    campus.lastActivityAt = maxDate(campus.lastActivityAt, row._max.updatedAt, row._max.sessionDate);
  }
  for (const row of conversationActivity) {
    const campus = ensureCampusMetric(metrics, row.organizationId);
    campus.lastActivityAt = maxDate(campus.lastActivityAt, row._max.createdAt);
  }
  for (const row of teacherRecordingActivity) {
    const campus = ensureCampusMetric(metrics, row.organizationId);
    campus.lastActivityAt = maxDate(campus.lastActivityAt, row._max.updatedAt, row._max.recordedAt, row._max.uploadedAt);
  }

  for (const job of conversationJobs) {
    applyJobMetric(metrics, {
      organizationId: job.conversation.organizationId,
      queued: job.status === JobStatus.QUEUED ? 1 : 0,
      running: job.status === JobStatus.RUNNING ? 1 : 0,
      stale:
        job.status === JobStatus.RUNNING &&
        isRunningStale({ startedAt: job.startedAt, leaseExpiresAt: job.leaseExpiresAt, now, staleCutoff })
          ? 1
          : 0,
      failed: job.status === JobStatus.ERROR ? 1 : 0,
    });
  }
  for (const job of sessionPartJobs) {
    applyJobMetric(metrics, {
      organizationId: job.sessionPart.session.organizationId,
      queued: job.status === JobStatus.QUEUED ? 1 : 0,
      running: job.status === JobStatus.RUNNING ? 1 : 0,
      stale: job.status === JobStatus.RUNNING && isRunningStale({ startedAt: job.startedAt, now, staleCutoff }) ? 1 : 0,
      failed: job.status === JobStatus.ERROR ? 1 : 0,
    });
  }
  for (const job of teacherRecordingJobs) {
    applyJobMetric(metrics, {
      organizationId: job.organizationId,
      queued: job.status === JobStatus.QUEUED ? 1 : 0,
      running: job.status === JobStatus.RUNNING ? 1 : 0,
      stale:
        job.status === JobStatus.RUNNING &&
        isRunningStale({
          startedAt: job.startedAt,
          processingLeaseExpiresAt: job.recordingSession.processingLeaseExpiresAt,
          now,
          staleCutoff,
        })
          ? 1
          : 0,
      failed: job.status === JobStatus.ERROR ? 1 : 0,
    });
  }
  for (const request of storageDeletionRequests) {
    applyJobMetric(metrics, {
      organizationId: request.organizationId,
      queued: request.status === "PENDING" ? 1 : 0,
      running: request.status === "RUNNING" ? 1 : 0,
      stale: request.status === "RUNNING" && request.updatedAt.getTime() <= staleCutoff.getTime() ? 1 : 0,
      failed: request.status === "ERROR" ? 1 : 0,
    });
  }
  for (const row of failedDeliveryEvents) {
    ensureCampusMetric(metrics, row.organizationId).failedJobCount += row._count._all;
  }

  return metrics;
}
