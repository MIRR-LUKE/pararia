import { Prisma, TeacherRecordingSessionStatus, type PrismaClient } from "@prisma/client";
import { buildRetentionExpiryDate, getAudioRetentionDays, getTranscriptRetentionDays } from "@/lib/system-config";
import { getTeacherRecordingRetentionPolicy } from "@/lib/teacher-app/recording-retention-policy";

export type DataRetentionDryRunRuleKey =
  | "teacher_recording_audio"
  | "teacher_recording_unconfirmed"
  | "teacher_recording_error"
  | "teacher_recording_no_student"
  | "teacher_recording_raw_transcript"
  | "session_part_audio"
  | "session_part_raw_transcript"
  | "conversation_raw_transcript";

export type DataRetentionDryRunTargetType =
  | "TeacherRecordingSession"
  | "SessionPart"
  | "ConversationLog";

export type DataRetentionDryRunRetention = {
  audioDays: number;
  transcriptDays: number;
  teacherRecordingUnconfirmedDays: number;
  teacherRecordingErrorDays: number;
  teacherRecordingNoStudentDays: number;
};

export type DataRetentionDryRunCutoffs = {
  audio: Date;
  transcript: Date;
  teacherRecordingUnconfirmed: Date;
  teacherRecordingError: Date;
  teacherRecordingNoStudent: Date;
};

export type DataRetentionDryRunRule = {
  key: DataRetentionDryRunRuleKey;
  label: string;
  targetType: DataRetentionDryRunTargetType;
  retentionDays: number;
  cutoff: Date;
  where:
    | Prisma.TeacherRecordingSessionWhereInput
    | Prisma.SessionPartWhereInput
    | Prisma.ConversationLogWhereInput;
  orderBy: unknown;
};

export type DataRetentionDryRunGroup = {
  key: DataRetentionDryRunRuleKey;
  label: string;
  targetType: DataRetentionDryRunTargetType;
  retentionDays: number;
  cutoff: string;
  count: number;
  ids: string[];
  truncated: boolean;
};

export type DataRetentionDryRunResult = {
  mode: "dry-run";
  willDelete: false;
  organizationId: string;
  ranAt: string;
  idLimit: number;
  retention: DataRetentionDryRunRetention;
  groups: DataRetentionDryRunGroup[];
  totalCandidateReferences: number;
};

export type TeacherRecordingCandidateRow = {
  id: string;
  organizationId: string;
  status: string;
  audioStorageUrl: string | null;
  transcriptText: string | null;
  transcriptSegmentsJson?: unknown | null;
  transcriptMetaJson?: unknown | null;
  selectedStudentId: string | null;
  promotedSessionId: string | null;
  promotedConversationId: string | null;
  uploadedAt: Date | null;
  recordedAt: Date | null;
  analyzedAt: Date | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SessionPartCandidateRow = {
  id: string;
  storageUrl: string | null;
  rawTextOriginal: string | null;
  rawTextCleaned: string | null;
  reviewedText: string | null;
  rawSegments?: unknown | null;
  transcriptExpiresAt: Date | null;
  createdAt: Date;
  session: {
    organizationId: string;
  };
};

export type ConversationCandidateRow = {
  id: string;
  organizationId: string;
  rawTextOriginal: string | null;
  rawTextCleaned: string | null;
  reviewedText: string | null;
  rawSegments?: unknown | null;
  rawTextExpiresAt: Date | null;
};

export type DataRetentionDryRunRows = {
  teacherRecordings: TeacherRecordingCandidateRow[];
  sessionParts: SessionPartCandidateRow[];
  conversations: ConversationCandidateRow[];
};

type CandidateModelDelegate = {
  count(args: { where: unknown }): Promise<number>;
  findMany(args: { where: unknown; select: { id: true }; orderBy: unknown; take: number }): Promise<Array<{ id: string }>>;
};

export type DataRetentionDryRunClient = Pick<PrismaClient, "teacherRecordingSession" | "sessionPart" | "conversationLog">;

const DEFAULT_ID_LIMIT = 200;
const MAX_ID_LIMIT = 10_000;
const UNCONFIRMED_TEACHER_RECORDING_STATUSES: TeacherRecordingSessionStatus[] = [
  TeacherRecordingSessionStatus.RECORDING,
  TeacherRecordingSessionStatus.TRANSCRIBING,
  TeacherRecordingSessionStatus.AWAITING_STUDENT_CONFIRMATION,
];

function normalizeIdLimit(input: number | null | undefined) {
  if (typeof input !== "number" || !Number.isFinite(input)) return DEFAULT_ID_LIMIT;
  return Math.max(1, Math.min(MAX_ID_LIMIT, Math.floor(input)));
}

function hasStoredValue(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function firstDate(...dates: Array<Date | null | undefined>) {
  return dates.find((date): date is Date => date instanceof Date) ?? null;
}

function isOnOrBefore(date: Date | null, cutoff: Date) {
  return date !== null && date.getTime() <= cutoff.getTime();
}

function buildRetention(input?: Partial<DataRetentionDryRunRetention>): DataRetentionDryRunRetention {
  const teacherRecordingPolicy = getTeacherRecordingRetentionPolicy();
  return {
    audioDays: input?.audioDays ?? getAudioRetentionDays(),
    transcriptDays: input?.transcriptDays ?? getTranscriptRetentionDays(),
    teacherRecordingUnconfirmedDays:
      input?.teacherRecordingUnconfirmedDays ?? teacherRecordingPolicy.unconfirmedDays,
    teacherRecordingErrorDays: input?.teacherRecordingErrorDays ?? teacherRecordingPolicy.errorDays,
    teacherRecordingNoStudentDays: input?.teacherRecordingNoStudentDays ?? teacherRecordingPolicy.noStudentDays,
  };
}

export function buildDataRetentionDryRunCutoffs(
  retention: DataRetentionDryRunRetention,
  now = new Date()
): DataRetentionDryRunCutoffs {
  return {
    audio: buildRetentionExpiryDate(-retention.audioDays, now),
    transcript: buildRetentionExpiryDate(-retention.transcriptDays, now),
    teacherRecordingUnconfirmed: buildRetentionExpiryDate(-retention.teacherRecordingUnconfirmedDays, now),
    teacherRecordingError: buildRetentionExpiryDate(-retention.teacherRecordingErrorDays, now),
    teacherRecordingNoStudent: buildRetentionExpiryDate(-retention.teacherRecordingNoStudentDays, now),
  };
}

export function buildDataRetentionDryRunRules(input: {
  organizationId: string;
  now?: Date;
  retention?: Partial<DataRetentionDryRunRetention>;
}) {
  const organizationId = input.organizationId.trim();
  if (!organizationId) {
    throw new Error("organizationId is required for retention dry-run candidate extraction");
  }

  const now = input.now ?? new Date();
  const retention = buildRetention(input.retention);
  const cutoffs = buildDataRetentionDryRunCutoffs(retention, now);

  const rules: DataRetentionDryRunRule[] = [
    {
      key: "teacher_recording_audio",
      label: "古いTeacher録音音声",
      targetType: "TeacherRecordingSession",
      retentionDays: retention.audioDays,
      cutoff: cutoffs.audio,
      where: {
        organizationId,
        audioStorageUrl: { not: null },
        OR: [
          { uploadedAt: { lte: cutoffs.audio } },
          { uploadedAt: null, recordedAt: { lte: cutoffs.audio } },
          { uploadedAt: null, recordedAt: null, createdAt: { lte: cutoffs.audio } },
        ],
      },
      orderBy: [{ uploadedAt: "asc" }, { recordedAt: "asc" }, { createdAt: "asc" }],
    },
    {
      key: "teacher_recording_unconfirmed",
      label: "古い未確定Teacher録音",
      targetType: "TeacherRecordingSession",
      retentionDays: retention.teacherRecordingUnconfirmedDays,
      cutoff: cutoffs.teacherRecordingUnconfirmed,
      where: {
        organizationId,
        confirmedAt: null,
        status: {
          in: UNCONFIRMED_TEACHER_RECORDING_STATUSES,
        },
        updatedAt: { lte: cutoffs.teacherRecordingUnconfirmed },
      },
      orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
    },
    {
      key: "teacher_recording_error",
      label: "古いERROR状態Teacher録音",
      targetType: "TeacherRecordingSession",
      retentionDays: retention.teacherRecordingErrorDays,
      cutoff: cutoffs.teacherRecordingError,
      where: {
        organizationId,
        status: TeacherRecordingSessionStatus.ERROR,
        updatedAt: { lte: cutoffs.teacherRecordingError },
      },
      orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
    },
    {
      key: "teacher_recording_no_student",
      label: "該当なしのまま放置されたTeacher録音",
      targetType: "TeacherRecordingSession",
      retentionDays: retention.teacherRecordingNoStudentDays,
      cutoff: cutoffs.teacherRecordingNoStudent,
      where: {
        organizationId,
        status: TeacherRecordingSessionStatus.STUDENT_CONFIRMED,
        selectedStudentId: null,
        promotedSessionId: null,
        promotedConversationId: null,
        OR: [
          { confirmedAt: { lte: cutoffs.teacherRecordingNoStudent } },
          { confirmedAt: null, updatedAt: { lte: cutoffs.teacherRecordingNoStudent } },
        ],
      },
      orderBy: [{ confirmedAt: "asc" }, { updatedAt: "asc" }],
    },
    {
      key: "teacher_recording_raw_transcript",
      label: "古いTeacher録音raw transcript",
      targetType: "TeacherRecordingSession",
      retentionDays: retention.transcriptDays,
      cutoff: cutoffs.transcript,
      where: {
        organizationId,
        AND: [
          {
            OR: [
              { transcriptText: { not: null } },
              { transcriptSegmentsJson: { not: Prisma.DbNull } },
              { transcriptMetaJson: { not: Prisma.DbNull } },
            ],
          },
          {
            OR: [
              { analyzedAt: { lte: cutoffs.transcript } },
              { analyzedAt: null, updatedAt: { lte: cutoffs.transcript } },
            ],
          },
        ],
      },
      orderBy: [{ analyzedAt: "asc" }, { updatedAt: "asc" }],
    },
    {
      key: "session_part_audio",
      label: "古い昇格済み録音音声",
      targetType: "SessionPart",
      retentionDays: retention.audioDays,
      cutoff: cutoffs.audio,
      where: {
        session: { organizationId },
        storageUrl: { not: null },
        createdAt: { lte: cutoffs.audio },
      },
      orderBy: [{ createdAt: "asc" }],
    },
    {
      key: "session_part_raw_transcript",
      label: "古いSessionPart raw transcript",
      targetType: "SessionPart",
      retentionDays: retention.transcriptDays,
      cutoff: now,
      where: {
        session: { organizationId },
        transcriptExpiresAt: { lte: now },
        OR: [
          { rawTextOriginal: { not: null } },
          { rawTextCleaned: { not: null } },
          { reviewedText: { not: null } },
          { rawSegments: { not: Prisma.DbNull } },
        ],
      },
      orderBy: [{ transcriptExpiresAt: "asc" }, { createdAt: "asc" }],
    },
    {
      key: "conversation_raw_transcript",
      label: "古いConversationLog raw transcript",
      targetType: "ConversationLog",
      retentionDays: retention.transcriptDays,
      cutoff: now,
      where: {
        organizationId,
        rawTextExpiresAt: { lte: now },
        OR: [
          { rawTextOriginal: { not: null } },
          { rawTextCleaned: { not: null } },
          { reviewedText: { not: null } },
          { rawSegments: { not: Prisma.DbNull } },
        ],
      },
      orderBy: [{ rawTextExpiresAt: "asc" }, { createdAt: "asc" }],
    },
  ];

  return {
    retention,
    cutoffs,
    rules,
  };
}

function teacherRecordingMatchesRule(
  row: TeacherRecordingCandidateRow,
  ruleKey: DataRetentionDryRunRuleKey,
  organizationId: string,
  cutoffs: DataRetentionDryRunCutoffs
) {
  if (row.organizationId !== organizationId) return false;

  if (ruleKey === "teacher_recording_audio") {
    return hasStoredValue(row.audioStorageUrl) && isOnOrBefore(firstDate(row.uploadedAt, row.recordedAt, row.createdAt), cutoffs.audio);
  }

  if (ruleKey === "teacher_recording_unconfirmed") {
    return (
      row.confirmedAt === null &&
      UNCONFIRMED_TEACHER_RECORDING_STATUSES.includes(row.status as TeacherRecordingSessionStatus) &&
      isOnOrBefore(row.updatedAt, cutoffs.teacherRecordingUnconfirmed)
    );
  }

  if (ruleKey === "teacher_recording_error") {
    return row.status === TeacherRecordingSessionStatus.ERROR && isOnOrBefore(row.updatedAt, cutoffs.teacherRecordingError);
  }

  if (ruleKey === "teacher_recording_no_student") {
    return (
      row.status === TeacherRecordingSessionStatus.STUDENT_CONFIRMED &&
      row.selectedStudentId === null &&
      row.promotedSessionId === null &&
      row.promotedConversationId === null &&
      isOnOrBefore(firstDate(row.confirmedAt, row.updatedAt), cutoffs.teacherRecordingNoStudent)
    );
  }

  if (ruleKey === "teacher_recording_raw_transcript") {
    return (
      (hasStoredValue(row.transcriptText) ||
        hasStoredValue(row.transcriptSegmentsJson) ||
        hasStoredValue(row.transcriptMetaJson)) &&
      isOnOrBefore(firstDate(row.analyzedAt, row.updatedAt), cutoffs.transcript)
    );
  }

  return false;
}

function sessionPartMatchesRule(
  row: SessionPartCandidateRow,
  ruleKey: DataRetentionDryRunRuleKey,
  organizationId: string,
  cutoffs: DataRetentionDryRunCutoffs,
  now: Date
) {
  if (row.session.organizationId !== organizationId) return false;

  if (ruleKey === "session_part_audio") {
    return hasStoredValue(row.storageUrl) && isOnOrBefore(row.createdAt, cutoffs.audio);
  }

  if (ruleKey === "session_part_raw_transcript") {
    return (
      isOnOrBefore(row.transcriptExpiresAt, now) &&
      (hasStoredValue(row.rawTextOriginal) ||
        hasStoredValue(row.rawTextCleaned) ||
        hasStoredValue(row.reviewedText) ||
        hasStoredValue(row.rawSegments))
    );
  }

  return false;
}

function conversationMatchesRule(
  row: ConversationCandidateRow,
  ruleKey: DataRetentionDryRunRuleKey,
  organizationId: string,
  now: Date
) {
  if (row.organizationId !== organizationId) return false;
  if (ruleKey !== "conversation_raw_transcript") return false;

  return (
    isOnOrBefore(row.rawTextExpiresAt, now) &&
    (hasStoredValue(row.rawTextOriginal) ||
      hasStoredValue(row.rawTextCleaned) ||
      hasStoredValue(row.reviewedText) ||
      hasStoredValue(row.rawSegments))
  );
}

export function collectDataRetentionDryRunCandidatesFromRows(input: {
  organizationId: string;
  rows: DataRetentionDryRunRows;
  now?: Date;
  retention?: Partial<DataRetentionDryRunRetention>;
  idLimit?: number;
}): DataRetentionDryRunResult {
  const now = input.now ?? new Date();
  const idLimit = normalizeIdLimit(input.idLimit);
  const { retention, cutoffs, rules } = buildDataRetentionDryRunRules({
    organizationId: input.organizationId,
    now,
    retention: input.retention,
  });

  const groups = rules.map((rule): DataRetentionDryRunGroup => {
    const rows =
      rule.targetType === "TeacherRecordingSession"
        ? input.rows.teacherRecordings.filter((row) =>
            teacherRecordingMatchesRule(row, rule.key, input.organizationId, cutoffs)
          )
        : rule.targetType === "SessionPart"
          ? input.rows.sessionParts.filter((row) =>
              sessionPartMatchesRule(row, rule.key, input.organizationId, cutoffs, now)
            )
          : input.rows.conversations.filter((row) =>
              conversationMatchesRule(row, rule.key, input.organizationId, now)
            );

    return {
      key: rule.key,
      label: rule.label,
      targetType: rule.targetType,
      retentionDays: rule.retentionDays,
      cutoff: rule.cutoff.toISOString(),
      count: rows.length,
      ids: rows.slice(0, idLimit).map((row) => row.id),
      truncated: rows.length > idLimit,
    };
  });

  return {
    mode: "dry-run",
    willDelete: false,
    organizationId: input.organizationId,
    ranAt: now.toISOString(),
    idLimit,
    retention,
    groups,
    totalCandidateReferences: groups.reduce((sum, group) => sum + group.count, 0),
  };
}

async function collectGroup(
  model: CandidateModelDelegate,
  rule: DataRetentionDryRunRule,
  idLimit: number
): Promise<DataRetentionDryRunGroup> {
  const [count, rows] = await Promise.all([
    model.count({ where: rule.where }),
    model.findMany({
      where: rule.where,
      select: { id: true },
      orderBy: rule.orderBy,
      take: idLimit,
    }),
  ]);

  return {
    key: rule.key,
    label: rule.label,
    targetType: rule.targetType,
    retentionDays: rule.retentionDays,
    cutoff: rule.cutoff.toISOString(),
    count,
    ids: rows.map((row) => row.id),
    truncated: count > rows.length,
  };
}

export async function collectDataRetentionDryRunCandidates(input: {
  client: DataRetentionDryRunClient;
  organizationId: string;
  now?: Date;
  retention?: Partial<DataRetentionDryRunRetention>;
  idLimit?: number;
}): Promise<DataRetentionDryRunResult> {
  const now = input.now ?? new Date();
  const idLimit = normalizeIdLimit(input.idLimit);
  const { retention, rules } = buildDataRetentionDryRunRules({
    organizationId: input.organizationId,
    now,
    retention: input.retention,
  });

  const groups = await Promise.all(
    rules.map((rule) => {
      const model =
        rule.targetType === "TeacherRecordingSession"
          ? input.client.teacherRecordingSession
          : rule.targetType === "SessionPart"
            ? input.client.sessionPart
            : input.client.conversationLog;
      return collectGroup(model as unknown as CandidateModelDelegate, rule, idLimit);
    })
  );

  return {
    mode: "dry-run",
    willDelete: false,
    organizationId: input.organizationId,
    ranAt: now.toISOString(),
    idLimit,
    retention,
    groups,
    totalCandidateReferences: groups.reduce((sum, group) => sum + group.count, 0),
  };
}
