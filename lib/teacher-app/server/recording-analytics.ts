import { ConversationStatus, JobStatus, TeacherRecordingJobType, TeacherRecordingSessionStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { withVisibleConversationWhere, withVisibleReportWhere } from "@/lib/content-visibility";
import { prisma } from "@/lib/db";

type DateLike = Date | null | undefined;
const DAY_MS = 24 * 60 * 60 * 1000;

export const TEACHER_RECORDING_ANALYTICS_DEFAULT_WINDOW_DAYS = 90;
export const TEACHER_RECORDING_ANALYTICS_MAX_WINDOW_DAYS = 180;

export type TeacherRecordingAnalyticsPeriod = {
  from?: Date | null;
  to?: Date | null;
};

export type NormalizedTeacherRecordingAnalyticsPeriod = {
  from: Date;
  to: Date;
};

export type TeacherRecordingAnalyticsJobRow = {
  type: TeacherRecordingJobType | string;
  status: JobStatus | string;
};

export type TeacherRecordingAnalyticsRecordingRow = {
  id: string;
  organizationId: string;
  status: TeacherRecordingSessionStatus | string;
  selectedStudentId: string | null;
  audioStorageUrl?: string | null;
  suggestedStudentsJson: Prisma.JsonValue | unknown;
  recordedAt: Date | null;
  uploadedAt: Date | null;
  analyzedAt: Date | null;
  confirmedAt: Date | null;
  promotionTriggeredAt: Date | null;
  promotedConversationId: string | null;
  createdAt: Date;
  jobs: TeacherRecordingAnalyticsJobRow[];
};

export type TeacherRecordingAnalyticsConversationRow = {
  id: string;
  organizationId: string;
  studentId: string;
  status: ConversationStatus | string;
  createdAt: Date;
  student?: {
    id: string;
    name: string;
  } | null;
};

export type TeacherRecordingAnalyticsReportRow = {
  id: string;
  organizationId: string;
  studentId: string;
  sourceLogIds: Prisma.JsonValue | unknown;
  createdAt: Date;
};

export type TeacherRecordingAnalyticsOrganizationRow = {
  id: string;
  name: string;
};

export type TeacherRecordingRateMetric = {
  denominator: number;
  count: number;
  rate: number | null;
};

export type TeacherRecordingIntervalStats = {
  count: number;
  averageMs: number | null;
  minMs: number | null;
  maxMs: number | null;
  p50Ms: number | null;
  p90Ms: number | null;
};

type TeacherRecordingIntervalKey =
  | "recordingToUpload"
  | "uploadToStt"
  | "sttToConfirmation"
  | "confirmationToPromotion"
  | "recordingToConfirmation";

export type TeacherRecordingAnalytics = {
  organization: {
    id: string;
    name: string;
  };
  generatedAt: string;
  period: {
    from: string | null;
    to: string | null;
    recordingDateField: "recordedAt";
    logDateField: "createdAt";
    reportDateField: "createdAt";
  };
  recordings: {
    totalCount: number;
    uploadedCount: number;
    statusCounts: Record<string, number>;
    recordingSuccess: TeacherRecordingRateMetric & {
      cancelledCount: number;
      errorCount: number;
      pendingCount: number;
    };
    sttSuccess: TeacherRecordingRateMetric & {
      failedCount: number;
      pendingCount: number;
    };
    studentConfirmation: {
      denominator: number;
      confirmedCount: number;
      unconfirmedCount: number;
      noStudentCount: number;
      confirmationRate: number | null;
      noStudentRate: number | null;
    };
    logGeneration: {
      denominator: number;
      generatedCount: number;
      generatedDoneCount: number;
      missingCount: number;
      generationRate: number | null;
      generatedDoneRate: number | null;
    };
    parentReportAdoption: {
      denominator: number;
      adoptedLogCount: number;
      unadoptedLogCount: number;
      adoptionRate: number | null;
    };
    intervals: Record<TeacherRecordingIntervalKey, TeacherRecordingIntervalStats>;
  };
  studentSuggestion: {
    denominator: number;
    unconfirmedCount: number;
    selectedCount: number;
    top1Count: number;
    top3Count: number;
    noStudentCount: number;
    candidateOutsideCount: number;
    top1Rate: number | null;
    top3Rate: number | null;
    noStudentRate: number | null;
    candidateOutsideRate: number | null;
  };
  logAdoption: {
    logCount: number;
    adoptedLogCount: number;
    unadoptedLogCount: number;
    adoptionRate: number | null;
    byStudent: Array<{
      studentId: string;
      studentName: string | null;
      logCount: number;
      adoptedLogCount: number;
      unadoptedLogCount: number;
      adoptionRate: number | null;
    }>;
    byOrganization: Array<{
      organizationId: string;
      organizationName: string | null;
      logCount: number;
      adoptedLogCount: number;
      unadoptedLogCount: number;
      adoptionRate: number | null;
    }>;
  };
};

export type BuildTeacherRecordingAnalyticsInput = {
  organization: TeacherRecordingAnalyticsOrganizationRow;
  recordings: TeacherRecordingAnalyticsRecordingRow[];
  conversations: TeacherRecordingAnalyticsConversationRow[];
  reports: TeacherRecordingAnalyticsReportRow[];
  period?: TeacherRecordingAnalyticsPeriod;
  generatedAt?: Date;
};

function toIsoDate(value: DateLike) {
  return value ? value.toISOString() : null;
}

function ratio(count: number, denominator: number) {
  return denominator > 0 ? count / denominator : null;
}

function increment(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

function parseStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0))
  );
}

function parseCandidateIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : typeof record.studentId === "string" ? record.studentId : null;
    if (id) ids.push(id);
  }
  return ids;
}

function hasTranscribeJobStatus(recording: TeacherRecordingAnalyticsRecordingRow, status: JobStatus) {
  return recording.jobs.some(
    (job) => job.type === TeacherRecordingJobType.TRANSCRIBE_AND_SUGGEST && job.status === status
  );
}

function isRecordingUploaded(recording: TeacherRecordingAnalyticsRecordingRow) {
  return Boolean(recording.uploadedAt || recording.audioStorageUrl);
}

function isSttSuccessful(recording: TeacherRecordingAnalyticsRecordingRow) {
  return Boolean(
    recording.analyzedAt ||
      recording.status === TeacherRecordingSessionStatus.AWAITING_STUDENT_CONFIRMATION ||
      recording.status === TeacherRecordingSessionStatus.STUDENT_CONFIRMED ||
      hasTranscribeJobStatus(recording, JobStatus.DONE)
  );
}

function isSttFailed(recording: TeacherRecordingAnalyticsRecordingRow) {
  if (isSttSuccessful(recording)) return false;
  return Boolean(
    hasTranscribeJobStatus(recording, JobStatus.ERROR) || recording.status === TeacherRecordingSessionStatus.ERROR
  );
}

function diffMs(start: DateLike, end: DateLike) {
  if (!start || !end) return null;
  const diff = end.getTime() - start.getTime();
  return Number.isFinite(diff) && diff >= 0 ? diff : null;
}

function intervalStats(values: number[]): TeacherRecordingIntervalStats {
  if (values.length === 0) {
    return {
      count: 0,
      averageMs: null,
      minMs: null,
      maxMs: null,
      p50Ms: null,
      p90Ms: null,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    averageMs: Math.round(total / sorted.length),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    p50Ms: percentile(0.5),
    p90Ms: percentile(0.9),
  };
}

function buildIntervals(recordings: TeacherRecordingAnalyticsRecordingRow[]) {
  const values: Record<TeacherRecordingIntervalKey, number[]> = {
    recordingToUpload: [],
    uploadToStt: [],
    sttToConfirmation: [],
    confirmationToPromotion: [],
    recordingToConfirmation: [],
  };

  for (const recording of recordings) {
    const recordingStartedAt = recording.recordedAt ?? recording.createdAt;
    const intervals: Array<[TeacherRecordingIntervalKey, number | null]> = [
      ["recordingToUpload", diffMs(recordingStartedAt, recording.uploadedAt)],
      ["uploadToStt", diffMs(recording.uploadedAt, recording.analyzedAt)],
      ["sttToConfirmation", diffMs(recording.analyzedAt, recording.confirmedAt)],
      ["confirmationToPromotion", diffMs(recording.confirmedAt, recording.promotionTriggeredAt)],
      ["recordingToConfirmation", diffMs(recordingStartedAt, recording.confirmedAt)],
    ];

    for (const [key, value] of intervals) {
      if (value !== null) values[key].push(value);
    }
  }

  return {
    recordingToUpload: intervalStats(values.recordingToUpload),
    uploadToStt: intervalStats(values.uploadToStt),
    sttToConfirmation: intervalStats(values.sttToConfirmation),
    confirmationToPromotion: intervalStats(values.confirmationToPromotion),
    recordingToConfirmation: intervalStats(values.recordingToConfirmation),
  };
}

function buildLogAdoption(input: {
  organization: TeacherRecordingAnalyticsOrganizationRow;
  conversations: TeacherRecordingAnalyticsConversationRow[];
  reports: TeacherRecordingAnalyticsReportRow[];
}) {
  const logsById = new Map(input.conversations.map((conversation) => [conversation.id, conversation]));
  const adoptedLogIds = new Set<string>();

  for (const report of input.reports) {
    const sourceLogIds = parseStringArray(report.sourceLogIds);
    for (const logId of sourceLogIds) {
      const log = logsById.get(logId);
      if (!log || log.organizationId !== report.organizationId) continue;
      adoptedLogIds.add(logId);
    }
  }

  const byStudent = new Map<
    string,
    {
      studentId: string;
      studentName: string | null;
      logCount: number;
      adoptedLogCount: number;
    }
  >();
  const byOrganization = new Map<
    string,
    {
      organizationId: string;
      organizationName: string | null;
      logCount: number;
      adoptedLogCount: number;
    }
  >();

  for (const log of input.conversations) {
    const adopted = adoptedLogIds.has(log.id) ? 1 : 0;
    const student = byStudent.get(log.studentId) ?? {
      studentId: log.studentId,
      studentName: log.student?.name ?? null,
      logCount: 0,
      adoptedLogCount: 0,
    };
    student.logCount += 1;
    student.adoptedLogCount += adopted;
    byStudent.set(log.studentId, student);

    const organization = byOrganization.get(log.organizationId) ?? {
      organizationId: log.organizationId,
      organizationName: log.organizationId === input.organization.id ? input.organization.name : null,
      logCount: 0,
      adoptedLogCount: 0,
    };
    organization.logCount += 1;
    organization.adoptedLogCount += adopted;
    byOrganization.set(log.organizationId, organization);
  }

  const adoptedLogCount = adoptedLogIds.size;
  const logCount = input.conversations.length;
  const mapRateRows = <T extends { logCount: number; adoptedLogCount: number }>(rows: T[]) =>
    rows
      .map((row) => ({
        ...row,
        unadoptedLogCount: row.logCount - row.adoptedLogCount,
        adoptionRate: ratio(row.adoptedLogCount, row.logCount),
      }))
      .sort((a, b) => b.logCount - a.logCount || b.adoptedLogCount - a.adoptedLogCount);

  return {
    logCount,
    adoptedLogCount,
    unadoptedLogCount: logCount - adoptedLogCount,
    adoptionRate: ratio(adoptedLogCount, logCount),
    byStudent: mapRateRows(Array.from(byStudent.values())),
    byOrganization: mapRateRows(Array.from(byOrganization.values())),
  };
}

export function buildTeacherRecordingAnalytics(input: BuildTeacherRecordingAnalyticsInput): TeacherRecordingAnalytics {
  const statusCounts: Record<string, number> = {};
  const generatedAt = input.generatedAt ?? new Date();
  const uploadedRecordings = input.recordings.filter(isRecordingUploaded);
  const sttSuccessfulRecordings = uploadedRecordings.filter(isSttSuccessful);
  const sttFailedCount = uploadedRecordings.filter(isSttFailed).length;
  const confirmedRecordings = input.recordings.filter(
    (recording) => recording.status === TeacherRecordingSessionStatus.STUDENT_CONFIRMED
  );
  const confirmedWithStudent = confirmedRecordings.filter((recording) => recording.selectedStudentId);
  const noStudentCount = confirmedRecordings.length - confirmedWithStudent.length;
  const conversationsById = new Map(input.conversations.map((conversation) => [conversation.id, conversation]));
  const generatedRecordings = confirmedWithStudent.filter(
    (recording) => typeof recording.promotedConversationId === "string" && recording.promotedConversationId.length > 0
  );
  const generatedDoneCount = generatedRecordings.filter(
    (recording) => conversationsById.get(recording.promotedConversationId ?? "")?.status === ConversationStatus.DONE
  ).length;

  for (const recording of input.recordings) {
    increment(statusCounts, String(recording.status));
  }

  let top1Count = 0;
  let top3Count = 0;
  let candidateOutsideCount = 0;

  for (const recording of confirmedRecordings) {
    if (!recording.selectedStudentId) continue;
    const candidateIds = parseCandidateIds(recording.suggestedStudentsJson);
    if (candidateIds[0] === recording.selectedStudentId) top1Count += 1;
    if (candidateIds.slice(0, 3).includes(recording.selectedStudentId)) top3Count += 1;
    if (!candidateIds.includes(recording.selectedStudentId)) candidateOutsideCount += 1;
  }

  const logAdoption = buildLogAdoption({
    organization: input.organization,
    conversations: input.conversations,
    reports: input.reports,
  });
  const sttSuccessCount = sttSuccessfulRecordings.length;
  const confirmedCount = confirmedRecordings.length;

  return {
    organization: {
      id: input.organization.id,
      name: input.organization.name,
    },
    generatedAt: generatedAt.toISOString(),
    period: {
      from: toIsoDate(input.period?.from),
      to: toIsoDate(input.period?.to),
      recordingDateField: "recordedAt",
      logDateField: "createdAt",
      reportDateField: "createdAt",
    },
    recordings: {
      totalCount: input.recordings.length,
      uploadedCount: uploadedRecordings.length,
      statusCounts,
      recordingSuccess: {
        denominator: input.recordings.length,
        count: uploadedRecordings.length,
        cancelledCount: statusCounts[TeacherRecordingSessionStatus.CANCELLED] ?? 0,
        errorCount: statusCounts[TeacherRecordingSessionStatus.ERROR] ?? 0,
        pendingCount: statusCounts[TeacherRecordingSessionStatus.RECORDING] ?? 0,
        rate: ratio(uploadedRecordings.length, input.recordings.length),
      },
      sttSuccess: {
        denominator: uploadedRecordings.length,
        count: sttSuccessCount,
        failedCount: sttFailedCount,
        pendingCount: Math.max(0, uploadedRecordings.length - sttSuccessCount - sttFailedCount),
        rate: ratio(sttSuccessCount, uploadedRecordings.length),
      },
      studentConfirmation: {
        denominator: sttSuccessCount,
        confirmedCount,
        unconfirmedCount: Math.max(0, sttSuccessCount - confirmedCount),
        noStudentCount,
        confirmationRate: ratio(confirmedCount, sttSuccessCount),
        noStudentRate: ratio(noStudentCount, confirmedCount),
      },
      logGeneration: {
        denominator: confirmedWithStudent.length,
        generatedCount: generatedRecordings.length,
        generatedDoneCount,
        missingCount: Math.max(0, confirmedWithStudent.length - generatedRecordings.length),
        generationRate: ratio(generatedRecordings.length, confirmedWithStudent.length),
        generatedDoneRate: ratio(generatedDoneCount, confirmedWithStudent.length),
      },
      parentReportAdoption: {
        denominator: logAdoption.logCount,
        adoptedLogCount: logAdoption.adoptedLogCount,
        unadoptedLogCount: logAdoption.unadoptedLogCount,
        adoptionRate: logAdoption.adoptionRate,
      },
      intervals: buildIntervals(input.recordings),
    },
    studentSuggestion: {
      denominator: confirmedCount,
      unconfirmedCount: Math.max(0, sttSuccessCount - confirmedCount),
      selectedCount: confirmedWithStudent.length,
      top1Count,
      top3Count,
      noStudentCount,
      candidateOutsideCount,
      top1Rate: ratio(top1Count, confirmedCount),
      top3Rate: ratio(top3Count, confirmedCount),
      noStudentRate: ratio(noStudentCount, confirmedCount),
      candidateOutsideRate: ratio(candidateOutsideCount, confirmedCount),
    },
    logAdoption,
  };
}

function buildDateFilter(period: NormalizedTeacherRecordingAnalyticsPeriod) {
  const filter: Prisma.DateTimeFilter = {};
  filter.gte = period.from;
  filter.lt = period.to;
  return Object.keys(filter).length > 0 ? filter : null;
}

export function normalizeTeacherRecordingAnalyticsPeriod(
  period?: TeacherRecordingAnalyticsPeriod,
  now = new Date()
): NormalizedTeacherRecordingAnalyticsPeriod {
  const rawFrom = period?.from ?? null;
  const rawTo = period?.to ?? null;
  if (rawFrom && Number.isNaN(rawFrom.getTime())) {
    throw new Error("from は有効な日時で指定してください。");
  }
  if (rawTo && Number.isNaN(rawTo.getTime())) {
    throw new Error("to は有効な日時で指定してください。");
  }
  const to = rawTo ?? now;
  if (Number.isNaN(to.getTime())) {
    throw new Error("to は有効な日時で指定してください。");
  }
  const defaultFrom = new Date(to.getTime() - TEACHER_RECORDING_ANALYTICS_DEFAULT_WINDOW_DAYS * DAY_MS);
  const normalized = {
    from: rawFrom ?? defaultFrom,
    to,
  };
  if (normalized.from && normalized.to && normalized.from.getTime() >= normalized.to.getTime()) {
    throw new Error("from は to より前の日時で指定してください。");
  }
  if (normalized.to.getTime() - normalized.from.getTime() > TEACHER_RECORDING_ANALYTICS_MAX_WINDOW_DAYS * DAY_MS) {
    throw new Error(`期間は最大${TEACHER_RECORDING_ANALYTICS_MAX_WINDOW_DAYS}日以内で指定してください。`);
  }
  return normalized;
}

function buildRecordingPeriodWhere(period: NormalizedTeacherRecordingAnalyticsPeriod): Prisma.TeacherRecordingSessionWhereInput {
  const dateFilter = buildDateFilter(period);
  if (!dateFilter) return {};
  return {
    OR: [
      { recordedAt: dateFilter },
      {
        recordedAt: null,
        createdAt: dateFilter,
      },
    ],
  };
}

function buildCreatedAtPeriodWhere(period: NormalizedTeacherRecordingAnalyticsPeriod) {
  const dateFilter = buildDateFilter(period);
  return dateFilter ? { createdAt: dateFilter } : {};
}

export async function getTeacherRecordingAnalyticsForOrganization(input: {
  organizationId: string;
  period?: TeacherRecordingAnalyticsPeriod;
}) {
  const period = normalizeTeacherRecordingAnalyticsPeriod(input.period);
  const [organization, recordings, conversations, reports] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: input.organizationId },
      select: { id: true, name: true },
    }),
    prisma.teacherRecordingSession.findMany({
      where: {
        organizationId: input.organizationId,
        ...buildRecordingPeriodWhere(period),
      },
      orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        organizationId: true,
        status: true,
        selectedStudentId: true,
        audioStorageUrl: true,
        suggestedStudentsJson: true,
        recordedAt: true,
        uploadedAt: true,
        analyzedAt: true,
        confirmedAt: true,
        promotionTriggeredAt: true,
        promotedConversationId: true,
        createdAt: true,
        jobs: {
          select: {
            type: true,
            status: true,
          },
        },
      },
    }),
    prisma.conversationLog.findMany({
      where: withVisibleConversationWhere({
        organizationId: input.organizationId,
        ...buildCreatedAtPeriodWhere(period),
      }),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        organizationId: true,
        studentId: true,
        status: true,
        createdAt: true,
        student: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
    prisma.report.findMany({
      where: withVisibleReportWhere({
        organizationId: input.organizationId,
        ...buildCreatedAtPeriodWhere(period),
      }),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        organizationId: true,
        studentId: true,
        sourceLogIds: true,
        createdAt: true,
      },
    }),
  ]);

  if (!organization) return null;

  return buildTeacherRecordingAnalytics({
    organization,
    recordings,
    conversations,
    reports,
    period,
  });
}
