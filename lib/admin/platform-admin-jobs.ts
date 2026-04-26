import { JobStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  type AdminAttentionItem,
  type AdminCrossCampusJobHealth,
  type AdminJobHealthSummary,
  type AdminJobKind,
  type PlatformOperatorContext,
} from "./platform-admin-types";
import { assertPlatformAdminReadable } from "./platform-operators";
import { STALE_THRESHOLD_MINUTES } from "./platform-admin-campus-metrics";

function toIsoString(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
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
        OR: [{ startedAt: { lte: input.staleCutoff } }, { recordingSession: { processingLeaseExpiresAt: { lte: input.now } } }],
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

export async function listAdminAttentionItems(options: {
  operator?: PlatformOperatorContext | null;
  organizationId?: string | null;
  take?: number;
} = {}): Promise<AdminAttentionItem[]> {
  if (options.operator !== undefined) assertPlatformAdminReadable(options.operator);

  const now = new Date();
  const staleCutoff = new Date(now.getTime() - STALE_THRESHOLD_MINUTES * 60 * 1000);
  const take = Math.max(1, Math.min(500, Math.floor(options.take ?? 100)));
  const organizationId = options.organizationId ?? undefined;

  const conversationJobs = await prisma.conversationJob.findMany({
    where: {
      conversation: organizationId ? { organizationId } : {},
      OR: [
        { status: JobStatus.ERROR },
        { status: JobStatus.RUNNING, OR: [{ leaseExpiresAt: { lte: now } }, { startedAt: { lte: staleCutoff } }] },
      ],
    },
    orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
    take,
    select: {
      id: true,
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
        { status: JobStatus.RUNNING, OR: [{ startedAt: { lte: staleCutoff } }, { recordingSession: { processingLeaseExpiresAt: { lte: now } } }] },
      ],
    },
    orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
    take,
    select: {
      id: true,
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

export async function getCrossCampusJobHealth(options: {
  operator?: PlatformOperatorContext | null;
  organizationId?: string | null;
  take?: number;
} = {}): Promise<AdminCrossCampusJobHealth> {
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
