import { prisma } from "@/lib/db";
import { buildStudentRowSelect, type StudentRowProjection } from "@/lib/students/student-row-query";

type SessionSummary = {
  id: string;
  status: string;
  type: "INTERVIEW" | "LESSON_REPORT";
  sessionDate: string;
  heroStateLabel?: string | null;
  heroOneLiner?: string | null;
  latestSummary?: string | null;
  conversation?: { id: string } | null;
};

type ReportSummary = {
  id: string;
  status: "DRAFT" | "REVIEWED" | "SENT" | string;
  createdAt: string;
  reviewedAt?: string | null;
  sentAt?: string | null;
  deliveryChannel?: string | null;
  sourceLogIds?: string[] | null;
  deliveryEvents?: Array<{
    id?: string;
    eventType: string;
    createdAt: string;
    deliveryChannel?: string | null;
    note?: string | null;
    actor?: {
      id?: string;
      name?: string | null;
      email?: string | null;
    } | null;
  }>;
};

type StudentReportRecord = {
  id: string;
  status: "DRAFT" | "REVIEWED" | "SENT" | string;
  createdAt: Date;
  reviewedAt?: Date | null;
  sentAt?: Date | null;
  deliveryChannel?: string | null;
  sourceLogIds?: unknown;
  deliveryEvents?: Array<{
    id?: string;
    eventType: string;
    createdAt: Date;
    deliveryChannel?: string | null;
    note?: string | null;
    actor?: {
      id?: string;
      name?: string | null;
      email?: string | null;
    } | null;
  }>;
};

export type StudentListRow = {
  id: string;
  name: string;
  nameKana?: string | null;
  grade?: string | null;
  course?: string | null;
  guardianNames?: string | null;
  profileCompleteness: number;
  profiles?: Array<{ profileData?: any }>;
  sessions?: SessionSummary[];
  reports?: ReportSummary[];
  _count?: { sessions: number; reports: number };
  recordingLock?: { mode: string; lockedByName: string } | null;
};

type ListStudentRowsOptions = {
  organizationId: string;
  limit?: number;
  includeRecordingLock?: boolean;
  projection?: StudentRowProjection;
};

function computeProfileCompleteness(profileData?: any) {
  const basic = Array.isArray(profileData?.basic) ? profileData.basic.length : 0;
  const personal = Array.isArray(profileData?.personal) ? profileData.personal.length : 0;
  return Math.min(100, (basic + personal) * 6);
}

function normalizeSourceLogIds(sourceLogIds: unknown): string[] | null {
  if (!Array.isArray(sourceLogIds)) return null;
  const normalized = sourceLogIds.filter((value): value is string => typeof value === "string" && value.length > 0);
  return normalized.length > 0 ? normalized : [];
}

export async function listStudentRows(options: ListStudentRowsOptions): Promise<StudentListRow[]> {
  const { organizationId, limit, includeRecordingLock = false, projection = "report" } = options;
  const now = includeRecordingLock ? new Date() : null;

  const students = await prisma.student.findMany({
    where: { organizationId },
    ...(typeof limit === "number" ? { take: Math.floor(limit) } : {}),
    select: buildStudentRowSelect(projection),
    orderBy: { createdAt: "desc" },
  });

  const rows: StudentListRow[] = students.map((student) => ({
    id: student.id,
    name: student.name,
    nameKana: student.nameKana,
    grade: student.grade,
    course: student.course,
    guardianNames: student.guardianNames,
    profileCompleteness: computeProfileCompleteness(student.profiles?.[0]?.profileData),
    profiles: student.profiles,
    sessions: student.sessions.map((session) => ({
      ...session,
      sessionDate: session.sessionDate.toISOString(),
    })),
    reports: (student.reports as StudentReportRecord[]).map((report) => ({
      ...report,
      createdAt: report.createdAt.toISOString(),
      reviewedAt: report.reviewedAt?.toISOString() ?? null,
      sentAt: report.sentAt?.toISOString() ?? null,
      sourceLogIds: normalizeSourceLogIds(report.sourceLogIds),
      deliveryEvents: (report.deliveryEvents ?? []).map((event) => ({
        ...event,
        createdAt: event.createdAt.toISOString(),
      })),
    })),
    _count:
      "_count" in student && student._count
        ? {
            sessions: student._count.sessions,
            reports: student._count.reports,
          }
        : undefined,
    recordingLock: null,
  }));

  if (!includeRecordingLock || !now || rows.length === 0) {
    return rows;
  }

  const activeLocks = await prisma.studentRecordingLock.findMany({
    where: {
      studentId: { in: rows.map((row) => row.id) },
      expiresAt: { gt: now },
    },
    select: {
      studentId: true,
      mode: true,
      lockedBy: { select: { name: true } },
    },
  });
  const lockByStudentId = new Map(activeLocks.map((lock) => [lock.studentId, lock]));

  return rows.map((row) => {
    const lock = lockByStudentId.get(row.id);
    return {
      ...row,
      recordingLock: lock
        ? {
            mode: lock.mode,
            lockedByName: lock.lockedBy.name,
          }
        : null,
    };
  });
}
