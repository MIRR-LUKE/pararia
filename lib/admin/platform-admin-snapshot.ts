import { JobStatus, TeacherAppDeviceStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  type AdminAttentionItem,
  type AdminCampusDetail,
  type AdminCampusListResult,
  type AdminCampusStatus,
  type AdminCampusSummary,
  type AdminCrossCampusJobHealth,
  type AdminJobHealthSummary,
  type AdminJobKind,
  type PlatformAdminSnapshot,
  type PlatformOperatorContext,
} from "./platform-admin-types";
import { assertPlatformAdminReadable } from "./platform-operators";

const DEFAULT_TAKE = 100;
const MAX_TAKE = 500;
const STALE_THRESHOLD_MINUTES = 15;

type CampusMetrics = {
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

export type ListAdminCampusesOptions = {
  operator?: PlatformOperatorContext | null;
  query?: string | null;
  status?: AdminCampusStatus | "all" | null;
  skip?: number;
  take?: number;
};

export type GetAdminCampusDetailOptions = {
  operator?: PlatformOperatorContext | null;
  organizationId: string;
};

export type GetCrossCampusJobHealthOptions = {
  operator?: PlatformOperatorContext | null;
  organizationId?: string | null;
  take?: number;
};

function toIsoString(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function normalizeTake(value: number | undefined) {
  if (!value || !Number.isFinite(value)) return DEFAULT_TAKE;
  return Math.max(1, Math.min(MAX_TAKE, Math.floor(value)));
}

function normalizeSkip(value: number | undefined) {
  if (!value || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function maxDate(...values: Array<Date | null | undefined>) {
  return values.reduce<Date | null>((latest, value) => {
    if (!value) return latest;
    if (!latest || value.getTime() > latest.getTime()) return value;
    return latest;
  }, null);
}

function secondsSince(value: Date | null | undefined, now: Date) {
  if (!value) return null;
  return Math.max(0, Math.floor((now.getTime() - value.getTime()) / 1000));
}

function readOptionalEnv(name: string) {
  const value = process.env[name]?.trim();
  return value || null;
}

function readRunpodConfigSummary() {
  const apiKey = readOptionalEnv("RUNPOD_API_KEY");
  return {
    configured: Boolean(apiKey && readOptionalEnv("RUNPOD_WORKER_IMAGE")),
    workerName: null,
    workerImage: null,
  };
}

function buildCampusStatus(input: {
  planCode: string;
  activeStudentCount: number;
  userCount: number;
  lastActivityAt: Date | null;
  staleJobCount: number;
  failedJobCount: number;
}): AdminCampusStatus {
  const plan = input.planCode.trim().toLowerCase();
  if (plan.includes("suspend") || plan.includes("停止")) return "suspended";
  if (input.staleJobCount > 0 || input.failedJobCount > 0) return "needs_attention";
  if (input.activeStudentCount === 0 && input.userCount <= 1 && !input.lastActivityAt) return "onboarding";
  return "active";
}

function statusLabel(status: AdminCampusStatus) {
  if (status === "needs_attention") return "要対応";
  if (status === "onboarding") return "導入準備中";
  if (status === "suspended") return "停止中";
  return "稼働中";
}

function jobKindLabel(kind: AdminJobKind) {
  if (kind === "conversation") return "面談ログ生成";
  if (kind === "session_part") return "音声処理";
  if (kind === "teacher_recording") return "Teacher App録音";
  if (kind === "storage_deletion") return "保存データ削除";
  if (kind === "delivery") return "配信";
  return "Runpod";
}

function jobStatusLabel(input: { status: string; stale?: boolean }) {
  if (input.stale) return "詰まり疑い";
  if (input.status === JobStatus.ERROR) return "失敗";
  if (input.status === JobStatus.RUNNING) return "処理中";
  if (input.status === JobStatus.QUEUED) return "待ち";
  if (input.status === JobStatus.DONE) return "完了";
  if (input.status === "FAILED" || input.status === "BOUNCED") return "配信失敗";
  return input.status;
}

function causeLabel(input: { kind: AdminJobKind; status: string; stale?: boolean }) {
  if (input.stale) return `${jobKindLabel(input.kind)}が想定時間を超えて進んでいません`;
  if (input.status === JobStatus.ERROR) return `${jobKindLabel(input.kind)}で失敗が記録されています`;
  if (input.status === "FAILED" || input.status === "BOUNCED") return "保護者向け配信が失敗しています";
  if (input.status === JobStatus.QUEUED) return `${jobKindLabel(input.kind)}の待ち行列が残っています`;
  return `${jobKindLabel(input.kind)}の状態確認が必要です`;
}

function nextActionLabel(input: { kind: AdminJobKind; stale?: boolean }) {
  if (input.kind === "delivery") return "校舎詳細で配信件数を確認する";
  if (input.kind === "storage_deletion") return "削除キューの状態を確認する";
  if (input.stale) return "対象ジョブの詳細と処理基盤の状態を確認する";
  return "校舎詳細で影響範囲を確認する";
}

function createEmptyMetrics(): CampusMetrics {
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

async function getCampusMetrics(organizationIds: string[], now: Date) {
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
    campus.lastActivityAt = maxDate(
      campus.lastActivityAt,
      row._max.updatedAt,
      row._max.recordedAt,
      row._max.uploadedAt
    );
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
      stale:
        job.status === JobStatus.RUNNING && isRunningStale({ startedAt: job.startedAt, now, staleCutoff }) ? 1 : 0,
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

function toCampusSummary(input: {
  organization: {
    id: string;
    name: string;
    planCode: string;
    studentLimit: number | null;
    createdAt: Date;
    updatedAt: Date;
    _count: {
      students: number;
      users: number;
      teacherAppDevices: number;
    };
  };
  metrics: CampusMetrics;
}): AdminCampusSummary {
  const status = buildCampusStatus({
    planCode: input.organization.planCode,
    activeStudentCount: input.organization._count.students,
    userCount: input.organization._count.users,
    lastActivityAt: input.metrics.lastActivityAt,
    staleJobCount: input.metrics.staleJobCount,
    failedJobCount: input.metrics.failedJobCount,
  });

  return {
    id: input.organization.id,
    name: input.organization.name,
    status,
    statusLabel: statusLabel(status),
    customerLabel: input.organization.name,
    planCode: input.organization.planCode,
    studentLimit: input.organization.studentLimit,
    activeStudentCount: input.organization._count.students,
    archivedStudentCount: input.metrics.archivedStudentCount,
    userCount: input.organization._count.users,
    activeTeacherDeviceCount: input.organization._count.teacherAppDevices,
    openIssueCount: input.metrics.staleJobCount + input.metrics.failedJobCount,
    queuedJobCount: input.metrics.queuedJobCount,
    runningJobCount: input.metrics.runningJobCount,
    staleJobCount: input.metrics.staleJobCount,
    failedJobCount: input.metrics.failedJobCount,
    lastActivityAt: toIsoString(input.metrics.lastActivityAt),
    createdAt: input.organization.createdAt.toISOString(),
    updatedAt: input.organization.updatedAt.toISOString(),
  };
}

function buildOrganizationWhere(query: string | null | undefined): Prisma.OrganizationWhereInput {
  const normalizedQuery = query?.trim();
  if (!normalizedQuery) return {};
  return {
    OR: [
      { name: { contains: normalizedQuery, mode: "insensitive" } },
      { planCode: { contains: normalizedQuery, mode: "insensitive" } },
      { id: { contains: normalizedQuery, mode: "insensitive" } },
    ],
  };
}

export async function listAdminCampuses(options: ListAdminCampusesOptions = {}): Promise<AdminCampusListResult> {
  if (options.operator !== undefined) assertPlatformAdminReadable(options.operator);

  const now = new Date();
  const take = normalizeTake(options.take);
  const skip = normalizeSkip(options.skip);
  const where = buildOrganizationWhere(options.query);

  const totalCount = await prisma.organization.count({ where });
  const organizations = await prisma.organization.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    skip,
    take,
    select: {
      id: true,
      name: true,
      planCode: true,
      studentLimit: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          users: true,
          students: { where: { archivedAt: null } },
          teacherAppDevices: { where: { status: TeacherAppDeviceStatus.ACTIVE } },
        },
      },
    },
  });

  const metrics = await getCampusMetrics(
    organizations.map((organization) => organization.id),
    now
  );

  const campuses = organizations
    .map((organization) =>
      toCampusSummary({
        organization,
        metrics: metrics.get(organization.id) ?? createEmptyMetrics(),
      })
    )
    .filter((campus) => !options.status || options.status === "all" || campus.status === options.status);

  return {
    campuses,
    totalCount,
    page: {
      take,
      skip,
      hasMore: skip + organizations.length < totalCount,
    },
  };
}

async function buildJobGroupSummary(input: {
  kind: AdminJobKind;
  organizationId?: string | null;
  now: Date;
  staleCutoff: Date;
}): Promise<AdminJobHealthSummary> {
  const organizationId = input.organizationId ?? undefined;

  if (input.kind === "conversation") {
    const conversationWhere = organizationId ? { organizationId } : {};
    const queued = await prisma.conversationJob.count({ where: { status: JobStatus.QUEUED, conversation: conversationWhere } });
    const running = await prisma.conversationJob.count({ where: { status: JobStatus.RUNNING, conversation: conversationWhere } });
    const failed = await prisma.conversationJob.count({ where: { status: JobStatus.ERROR, conversation: conversationWhere } });
    const stale = await prisma.conversationJob.count({
      where: {
        status: JobStatus.RUNNING,
        conversation: conversationWhere,
        OR: [{ leaseExpiresAt: { lte: input.now } }, { startedAt: { lte: input.staleCutoff } }],
      },
    });
    const oldestQueued = await prisma.conversationJob.findFirst({
      where: { status: JobStatus.QUEUED, conversation: conversationWhere },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    const oldestRunning = await prisma.conversationJob.findFirst({
      where: { status: JobStatus.RUNNING, conversation: conversationWhere },
      orderBy: { startedAt: "asc" },
      select: { startedAt: true },
    });
    return {
      kind: input.kind,
      label: jobKindLabel(input.kind),
      queued,
      running,
      stale,
      failed,
      oldestQueuedAt: toIsoString(oldestQueued?.createdAt),
      oldestRunningStartedAt: toIsoString(oldestRunning?.startedAt),
    };
  }

  if (input.kind === "session_part") {
    const sessionWhere = organizationId ? { organizationId } : {};
    const queued = await prisma.sessionPartJob.count({ where: { status: JobStatus.QUEUED, sessionPart: { session: sessionWhere } } });
    const running = await prisma.sessionPartJob.count({ where: { status: JobStatus.RUNNING, sessionPart: { session: sessionWhere } } });
    const failed = await prisma.sessionPartJob.count({ where: { status: JobStatus.ERROR, sessionPart: { session: sessionWhere } } });
    const stale = await prisma.sessionPartJob.count({
      where: {
        status: JobStatus.RUNNING,
        sessionPart: { session: sessionWhere },
        startedAt: { lte: input.staleCutoff },
      },
    });
    const oldestQueued = await prisma.sessionPartJob.findFirst({
      where: { status: JobStatus.QUEUED, sessionPart: { session: sessionWhere } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    const oldestRunning = await prisma.sessionPartJob.findFirst({
      where: { status: JobStatus.RUNNING, sessionPart: { session: sessionWhere } },
      orderBy: { startedAt: "asc" },
      select: { startedAt: true },
    });
    return {
      kind: input.kind,
      label: jobKindLabel(input.kind),
      queued,
      running,
      stale,
      failed,
      oldestQueuedAt: toIsoString(oldestQueued?.createdAt),
      oldestRunningStartedAt: toIsoString(oldestRunning?.startedAt),
    };
  }

  if (input.kind === "teacher_recording") {
    const baseWhere = organizationId ? { organizationId } : {};
    const queued = await prisma.teacherRecordingJob.count({ where: { ...baseWhere, status: JobStatus.QUEUED } });
    const running = await prisma.teacherRecordingJob.count({ where: { ...baseWhere, status: JobStatus.RUNNING } });
    const failed = await prisma.teacherRecordingJob.count({ where: { ...baseWhere, status: JobStatus.ERROR } });
    const stale = await prisma.teacherRecordingJob.count({
      where: {
        ...baseWhere,
        status: JobStatus.RUNNING,
        OR: [
          { startedAt: { lte: input.staleCutoff } },
          { recordingSession: { processingLeaseExpiresAt: { lte: input.now } } },
        ],
      },
    });
    const oldestQueued = await prisma.teacherRecordingJob.findFirst({
      where: { ...baseWhere, status: JobStatus.QUEUED },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    const oldestRunning = await prisma.teacherRecordingJob.findFirst({
      where: { ...baseWhere, status: JobStatus.RUNNING },
      orderBy: { startedAt: "asc" },
      select: { startedAt: true },
    });
    return {
      kind: input.kind,
      label: jobKindLabel(input.kind),
      queued,
      running,
      stale,
      failed,
      oldestQueuedAt: toIsoString(oldestQueued?.createdAt),
      oldestRunningStartedAt: toIsoString(oldestRunning?.startedAt),
    };
  }

  if (input.kind === "storage_deletion") {
    const baseWhere = organizationId ? { organizationId } : {};
    const queued = await prisma.storageDeletionRequest.count({ where: { ...baseWhere, status: "PENDING" } });
    const running = await prisma.storageDeletionRequest.count({ where: { ...baseWhere, status: "RUNNING" } });
    const failed = await prisma.storageDeletionRequest.count({ where: { ...baseWhere, status: "ERROR" } });
    const stale = await prisma.storageDeletionRequest.count({
      where: { ...baseWhere, status: "RUNNING", updatedAt: { lte: input.staleCutoff } },
    });
    const oldestQueued = await prisma.storageDeletionRequest.findFirst({
      where: { ...baseWhere, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    const oldestRunning = await prisma.storageDeletionRequest.findFirst({
      where: { ...baseWhere, status: "RUNNING" },
      orderBy: { updatedAt: "asc" },
      select: { updatedAt: true },
    });
    return {
      kind: input.kind,
      label: jobKindLabel(input.kind),
      queued,
      running,
      stale,
      failed,
      oldestQueuedAt: toIsoString(oldestQueued?.createdAt),
      oldestRunningStartedAt: toIsoString(oldestRunning?.updatedAt),
    };
  }

  const baseWhere = organizationId ? { organizationId } : {};
  const failed = await prisma.reportDeliveryEvent.count({
    where: { ...baseWhere, eventType: { in: ["FAILED", "BOUNCED"] } },
  });
  return {
    kind: "delivery",
    label: jobKindLabel("delivery"),
    queued: 0,
    running: 0,
    stale: 0,
    failed,
    oldestQueuedAt: null,
    oldestRunningStartedAt: null,
  };
}

function sortAttentionItems(items: AdminAttentionItem[]) {
  const severityRank = { critical: 0, warning: 1, info: 2 } satisfies Record<string, number>;
  return [...items].sort((a, b) => {
    const severityDiff = severityRank[a.severity] - severityRank[b.severity];
    if (severityDiff !== 0) return severityDiff;
    return (a.occurredAt ?? "").localeCompare(b.occurredAt ?? "");
  });
}

export async function listAdminAttentionItems(options: GetCrossCampusJobHealthOptions = {}): Promise<AdminAttentionItem[]> {
  if (options.operator !== undefined) assertPlatformAdminReadable(options.operator);

  const now = new Date();
  const staleCutoff = new Date(now.getTime() - STALE_THRESHOLD_MINUTES * 60 * 1000);
  const take = normalizeTake(options.take);
  const organizationId = options.organizationId ?? undefined;

  const conversationJobs = await prisma.conversationJob.findMany({
    where: {
      conversation: organizationId ? { organizationId } : {},
      OR: [
        { status: JobStatus.ERROR },
        {
          status: JobStatus.RUNNING,
          OR: [{ leaseExpiresAt: { lte: now } }, { startedAt: { lte: staleCutoff } }],
        },
      ],
    },
    orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
    take,
    select: {
      id: true,
      conversationId: true,
      status: true,
      startedAt: true,
      leaseExpiresAt: true,
      createdAt: true,
      conversation: { select: { organizationId: true, organization: { select: { name: true } } } },
    },
  });
  const sessionPartJobs = await prisma.sessionPartJob.findMany({
    where: {
      sessionPart: { session: organizationId ? { organizationId } : {} },
      OR: [{ status: JobStatus.ERROR }, { status: JobStatus.RUNNING, startedAt: { lte: staleCutoff } }],
    },
    orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
    take,
    select: {
      id: true,
      sessionPartId: true,
      status: true,
      startedAt: true,
      createdAt: true,
      sessionPart: { select: { session: { select: { organizationId: true, organization: { select: { name: true } } } } } },
    },
  });
  const teacherRecordingJobs = await prisma.teacherRecordingJob.findMany({
    where: {
      ...(organizationId ? { organizationId } : {}),
      OR: [
        { status: JobStatus.ERROR },
        {
          status: JobStatus.RUNNING,
          OR: [
            { startedAt: { lte: staleCutoff } },
            { recordingSession: { processingLeaseExpiresAt: { lte: now } } },
          ],
        },
      ],
    },
    orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
    take,
    select: {
      id: true,
      recordingSessionId: true,
      organizationId: true,
      status: true,
      startedAt: true,
      createdAt: true,
      organization: { select: { name: true } },
      recordingSession: { select: { processingLeaseExpiresAt: true } },
    },
  });
  const storageRequests = await prisma.storageDeletionRequest.findMany({
    where: {
      ...(organizationId ? { organizationId } : {}),
      OR: [{ status: "ERROR" }, { status: "RUNNING", updatedAt: { lte: staleCutoff } }],
    },
    orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
    take,
    select: {
      id: true,
      organizationId: true,
      status: true,
      updatedAt: true,
      createdAt: true,
    },
  });
  const deliveryEvents = await prisma.reportDeliveryEvent.findMany({
    where: {
      ...(organizationId ? { organizationId } : {}),
      eventType: { in: ["FAILED", "BOUNCED"] },
    },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      reportId: true,
      organizationId: true,
      eventType: true,
      createdAt: true,
      organization: { select: { name: true } },
    },
  });

  const storageOrganizationIds = Array.from(
    new Set(storageRequests.map((request) => request.organizationId).filter((id): id is string => Boolean(id)))
  );
  const storageOrganizations = storageOrganizationIds.length
    ? await prisma.organization.findMany({
        where: { id: { in: storageOrganizationIds } },
        select: { id: true, name: true },
      })
    : [];
  const storageOrganizationNames = new Map(storageOrganizations.map((organization) => [organization.id, organization.name]));

  return sortAttentionItems([
    ...conversationJobs.map((job) => {
      const stale = job.status === JobStatus.RUNNING;
      return {
        id: `conversation:${job.id}`,
        campusId: job.conversation.organizationId,
        campusName: job.conversation.organization.name,
        severity: job.status === JobStatus.ERROR ? "critical" : "warning",
        kind: "conversation",
        status: job.status,
        statusLabel: jobStatusLabel({ status: job.status, stale }),
        title: jobKindLabel("conversation"),
        causeLabel: causeLabel({ kind: "conversation", status: job.status, stale }),
        nextActionLabel: nextActionLabel({ kind: "conversation", stale }),
        targetType: "ConversationJob",
        targetId: job.id,
        occurredAt: toIsoString(job.startedAt ?? job.leaseExpiresAt ?? job.createdAt),
        elapsedSeconds: secondsSince(job.startedAt ?? job.createdAt, now),
      } satisfies AdminAttentionItem;
    }),
    ...sessionPartJobs.map((job) => {
      const stale = job.status === JobStatus.RUNNING;
      return {
        id: `session_part:${job.id}`,
        campusId: job.sessionPart.session.organizationId,
        campusName: job.sessionPart.session.organization.name,
        severity: job.status === JobStatus.ERROR ? "critical" : "warning",
        kind: "session_part",
        status: job.status,
        statusLabel: jobStatusLabel({ status: job.status, stale }),
        title: jobKindLabel("session_part"),
        causeLabel: causeLabel({ kind: "session_part", status: job.status, stale }),
        nextActionLabel: nextActionLabel({ kind: "session_part", stale }),
        targetType: "SessionPartJob",
        targetId: job.id,
        occurredAt: toIsoString(job.startedAt ?? job.createdAt),
        elapsedSeconds: secondsSince(job.startedAt ?? job.createdAt, now),
      } satisfies AdminAttentionItem;
    }),
    ...teacherRecordingJobs.map((job) => {
      const stale = job.status === JobStatus.RUNNING;
      return {
        id: `teacher_recording:${job.id}`,
        campusId: job.organizationId,
        campusName: job.organization.name,
        severity: job.status === JobStatus.ERROR ? "critical" : "warning",
        kind: "teacher_recording",
        status: job.status,
        statusLabel: jobStatusLabel({ status: job.status, stale }),
        title: jobKindLabel("teacher_recording"),
        causeLabel: causeLabel({ kind: "teacher_recording", status: job.status, stale }),
        nextActionLabel: nextActionLabel({ kind: "teacher_recording", stale }),
        targetType: "TeacherRecordingJob",
        targetId: job.id,
        occurredAt: toIsoString(job.startedAt ?? job.recordingSession.processingLeaseExpiresAt ?? job.createdAt),
        elapsedSeconds: secondsSince(job.startedAt ?? job.createdAt, now),
      } satisfies AdminAttentionItem;
    }),
    ...storageRequests.map((request) => {
      const stale = request.status === "RUNNING";
      return {
        id: `storage_deletion:${request.id}`,
        campusId: request.organizationId,
        campusName: request.organizationId ? storageOrganizationNames.get(request.organizationId) ?? null : null,
        severity: request.status === "ERROR" ? "critical" : "warning",
        kind: "storage_deletion",
        status: request.status,
        statusLabel: stale ? "詰まり疑い" : "失敗",
        title: jobKindLabel("storage_deletion"),
        causeLabel: causeLabel({ kind: "storage_deletion", status: request.status, stale }),
        nextActionLabel: nextActionLabel({ kind: "storage_deletion", stale }),
        targetType: "StorageDeletionRequest",
        targetId: request.id,
        occurredAt: toIsoString(request.updatedAt ?? request.createdAt),
        elapsedSeconds: secondsSince(request.updatedAt ?? request.createdAt, now),
      } satisfies AdminAttentionItem;
    }),
    ...deliveryEvents.map((event) => ({
      id: `delivery:${event.id}`,
      campusId: event.organizationId,
      campusName: event.organization.name,
      severity: "warning" as const,
      kind: "delivery" as const,
      status: event.eventType,
      statusLabel: jobStatusLabel({ status: event.eventType }),
      title: jobKindLabel("delivery"),
      causeLabel: causeLabel({ kind: "delivery", status: event.eventType }),
      nextActionLabel: nextActionLabel({ kind: "delivery" }),
      targetType: "ReportDeliveryEvent",
      targetId: event.id,
      occurredAt: event.createdAt.toISOString(),
      elapsedSeconds: secondsSince(event.createdAt, now),
    })),
  ]).slice(0, take);
}

export async function getCrossCampusJobHealth(
  options: GetCrossCampusJobHealthOptions = {}
): Promise<AdminCrossCampusJobHealth> {
  if (options.operator !== undefined) assertPlatformAdminReadable(options.operator);

  const now = new Date();
  const staleCutoff = new Date(now.getTime() - STALE_THRESHOLD_MINUTES * 60 * 1000);
  const groups: AdminJobHealthSummary[] = [];
  for (const kind of ["teacher_recording", "session_part", "conversation", "storage_deletion", "delivery"] as const) {
    groups.push(
      await buildJobGroupSummary({
        kind,
        organizationId: options.organizationId,
        now,
        staleCutoff,
      })
    );
  }
  const attentionItems = await listAdminAttentionItems(options);

  return {
    generatedAt: now.toISOString(),
    staleThresholdMinutes: STALE_THRESHOLD_MINUTES,
    groups,
    attentionItems,
    runpod: readRunpodConfigSummary(),
  };
}

export async function getAdminCampusDetail(options: GetAdminCampusDetailOptions): Promise<AdminCampusDetail | null> {
  if (options.operator !== undefined) assertPlatformAdminReadable(options.operator);

  const now = new Date();
  const organization = await prisma.organization.findUnique({
    where: { id: options.organizationId },
    select: {
      id: true,
      name: true,
      planCode: true,
      studentLimit: true,
      defaultLocale: true,
      defaultTimeZone: true,
      guardianConsentRequired: true,
      consentVersion: true,
      consentUpdatedAt: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          users: true,
          students: { where: { archivedAt: null } },
          teacherAppDevices: { where: { status: TeacherAppDeviceStatus.ACTIVE } },
        },
      },
    },
  });

  if (!organization) return null;

  const metrics = await getCampusMetrics([options.organizationId], now);
  const conversationCount = await prisma.conversationLog.count({
    where: { organizationId: options.organizationId, deletedAt: null },
  });
  const sessionCount = await prisma.session.count({ where: { organizationId: options.organizationId } });
  const reportCount = await prisma.report.count({ where: { organizationId: options.organizationId, deletedAt: null } });
  const deletedConversationCount = await prisma.conversationLog.count({
    where: { organizationId: options.organizationId, deletedAt: { not: null } },
  });
  const deletedReportCount = await prisma.report.count({
    where: { organizationId: options.organizationId, deletedAt: { not: null } },
  });
  const users = await prisma.user.groupBy({
    by: ["role"],
    where: { organizationId: options.organizationId },
    _count: { _all: true },
  });
  const pendingInvitationCount = await prisma.organizationInvitation.count({
    where: { organizationId: options.organizationId, acceptedAt: null, expiresAt: { gt: now } },
  });
  const expiredInvitationCount = await prisma.organizationInvitation.count({
    where: { organizationId: options.organizationId, acceptedAt: null, expiresAt: { lte: now } },
  });
  const devices = await prisma.teacherAppDevice.groupBy({
    by: ["status"],
    where: { organizationId: options.organizationId },
    _count: { _all: true },
  });
  const jobs = await getCrossCampusJobHealth({ ...options, organizationId: options.organizationId });
  const recentPlatformActions = await prisma.platformAuditLog.findMany({
    where: { targetOrganizationId: options.organizationId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      action: true,
      status: true,
      riskLevel: true,
      targetType: true,
      targetId: true,
      createdAt: true,
    },
  });

  const campus = toCampusSummary({
    organization,
    metrics: metrics.get(options.organizationId) ?? createEmptyMetrics(),
  });
  const usersByRole = Object.fromEntries(users.map((row) => [row.role, row._count._all]));
  const activeDevices = devices.find((row) => row.status === TeacherAppDeviceStatus.ACTIVE)?._count._all ?? 0;
  const revokedDevices = devices.find((row) => row.status === TeacherAppDeviceStatus.REVOKED)?._count._all ?? 0;

  return {
    campus,
    overview: {
      defaultLocale: organization.defaultLocale,
      defaultTimeZone: organization.defaultTimeZone,
      guardianConsentRequired: organization.guardianConsentRequired,
      consentVersion: organization.consentVersion ?? null,
      consentUpdatedAt: toIsoString(organization.consentUpdatedAt),
      conversationCount,
      sessionCount,
      reportCount,
      deletedConversationCount,
      deletedReportCount,
    },
    users: {
      total: organization._count.users,
      byRole: usersByRole,
      pendingInvitationCount,
      expiredInvitationCount,
    },
    jobs,
    devices: {
      total: activeDevices + revokedDevices,
      active: activeDevices,
      revoked: revokedDevices,
      recentlySeen: activeDevices,
    },
    audits: {
      recentPlatformActions: recentPlatformActions.map((entry) => ({
        id: entry.id,
        action: entry.action,
        status: entry.status,
        riskLevel: entry.riskLevel,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        createdAt: entry.createdAt.toISOString(),
      })),
    },
  };
}

export async function getPlatformAdminSnapshot(options: {
  operator?: PlatformOperatorContext | null;
  query?: string | null;
  status?: AdminCampusStatus | "all" | null;
  skip?: number;
  take?: number;
} = {}): Promise<PlatformAdminSnapshot> {
  if (options.operator !== undefined) assertPlatformAdminReadable(options.operator);

  const campuses = await listAdminCampuses(options);
  const summaryCampuses = await listAdminCampuses({ ...options, skip: 0, take: MAX_TAKE });
  const jobHealth = await getCrossCampusJobHealth({ operator: options.operator });
  const summary = summaryCampuses.campuses.reduce(
    (acc, campus) => {
      acc.needsAttentionCampusCount += campus.status === "needs_attention" ? 1 : 0;
      acc.queuedJobCount += campus.queuedJobCount;
      acc.runningJobCount += campus.runningJobCount;
      acc.staleJobCount += campus.staleJobCount;
      acc.failedJobCount += campus.failedJobCount;
      return acc;
    },
    {
      campusCount: summaryCampuses.totalCount,
      needsAttentionCampusCount: 0,
      queuedJobCount: 0,
      runningJobCount: 0,
      staleJobCount: 0,
      failedJobCount: 0,
    }
  );

  return {
    generatedAt: new Date().toISOString(),
    operator: options.operator ?? null,
    summary,
    campuses,
    attention: jobHealth.attentionItems,
    jobHealth,
  };
}
