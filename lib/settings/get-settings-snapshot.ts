import { prisma } from "@/lib/db";
import { canManageSettings } from "@/lib/permissions";
import { withActiveStudentWhere } from "@/lib/students/student-lifecycle";
import { getSendingConfigSummary, getTrustPolicySummary } from "@/lib/system-config";

export type MissingStudent = {
  id: string;
  name: string;
  grade?: string | null;
  guardianNames?: string | null;
};

export type OperationsJobRow = {
  id: string;
  kind: "conversation" | "session_part";
  targetId: string;
  sessionId: string | null;
  studentId: string | null;
  studentName: string | null;
  jobType: string;
  status: string;
  statusLabel: string;
  fileName: string | null;
  partType: string | null;
  lastError: string | null;
  nextRetryAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
  leaseExpiresAt: string | null;
};

export type DeletedContentRow = {
  id: string;
  kind: "conversation" | "report";
  studentId: string;
  studentName: string | null;
  deletedAt: string;
  deletedByLabel: string | null;
  note: string | null;
  sessionId: string | null;
};

export type SettingsSnapshot = {
  organization: {
    id: string;
    name: string;
    planCode: string;
    studentLimit: number | null;
    defaultLocale: string;
    defaultTimeZone: string;
    guardianConsentRequired: boolean;
    consentVersion: string | null;
    consentUpdatedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  permissions: {
    viewerRole?: string;
    canManage: boolean;
    roleCounts: Record<string, number>;
    policyRows: Array<{
      label: string;
      roles: string;
      note: string;
    }>;
  };
  guardianContacts: {
    totalStudents: number;
    studentsWithGuardian: number;
    studentsMissingGuardian: number;
      coveragePercent: number;
      missingStudents: MissingStudent[];
  };
  invitations: {
    pendingCount: number;
    expiredCount: number;
    acceptedCount: number;
    recentPending: Array<{
      id: string;
      email: string;
      role: string;
      expiresAt: string;
    }>;
  };
  operations: {
    queuedConversationJobs: number;
    runningConversationJobs: number;
    staleConversationJobs: number;
    queuedSessionPartJobs: number;
    runningSessionPartJobs: number;
    staleSessionPartJobs: number;
    archivedStudents: number;
    conversationJobRows: OperationsJobRow[];
    sessionPartJobRows: OperationsJobRow[];
    deletedConversations: DeletedContentRow[];
    deletedReports: DeletedContentRow[];
    recentAuditLogs: Array<{
      id: string;
      action: string;
      status: string;
      targetType: string | null;
      targetId: string | null;
      createdAt: string;
    }>;
  };
  sending: {
    provider: "resend" | "postmark" | "none";
    manualShareEnabled: boolean;
    emailConfigured: boolean;
    lineConfigured: boolean;
    emailStatusLabel: string;
    lineStatusLabel: string;
  };
  trust: {
    transcriptRetentionDays: number;
    reportDeliveryEventRetentionDays: number;
    guardianNoticeRequired: boolean;
    deletionRequestFlow: string;
  };
};

function toIsoString(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function buildJobStatusLabel(input: {
  status: string;
  nextRetryAt?: Date | null;
  now: Date;
}) {
  if (input.nextRetryAt && input.nextRetryAt.getTime() > input.now.getTime()) {
    return "やり直し待ち";
  }
  if (input.status === "RUNNING") return "実行中";
  if (input.status === "QUEUED") return "待ち";
  if (input.status === "ERROR") return "失敗";
  if (input.status === "DONE") return "完了";
  return input.status;
}

function pickDeletedByLabel(input: { name?: string | null; email?: string | null } | null | undefined) {
  if (!input) return null;
  return input.name?.trim() || input.email?.trim() || null;
}

type GetSettingsSnapshotOptions = {
  organizationId: string;
  viewerRole?: string;
};

export async function getSettingsSnapshot({
  organizationId,
  viewerRole,
}: GetSettingsSnapshotOptions): Promise<SettingsSnapshot | null> {
  const now = new Date();
  const staleJobCutoff = new Date(now.getTime() - 15 * 60 * 1000);

  const [
    organization,
    users,
    totalStudents,
    studentsWithGuardian,
    missingGuardianStudents,
    pendingInvitations,
    expiredInvitations,
    acceptedInvitations,
    recentPendingInvitations,
    queuedConversationJobs,
    runningConversationJobs,
    staleConversationJobs,
    queuedSessionPartJobs,
    runningSessionPartJobs,
    staleSessionPartJobs,
    archivedStudents,
    conversationJobRows,
    sessionPartJobRows,
    deletedConversations,
    deletedReports,
    recentAuditLogs,
  ] = await prisma.$transaction([
    prisma.organization.findUnique({
      where: { id: organizationId },
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
      },
    }),
    prisma.user.findMany({
      where: { organizationId },
      select: { role: true },
    }),
    prisma.student.count({
      where: withActiveStudentWhere({ organizationId }),
    }),
    prisma.student.count({
      where: withActiveStudentWhere({
        organizationId,
        guardianNames: {
          not: "",
        },
      }),
    }),
    prisma.student.findMany({
      where: withActiveStudentWhere({
        organizationId,
        OR: [{ guardianNames: null }, { guardianNames: "" }],
      }),
      select: {
        id: true,
        name: true,
        grade: true,
        guardianNames: true,
      },
      orderBy: [{ grade: "asc" }, { createdAt: "desc" }],
      take: 8,
    }),
    prisma.organizationInvitation.count({
      where: {
        organizationId,
        acceptedAt: null,
        expiresAt: { gt: now },
      },
    }),
    prisma.organizationInvitation.count({
      where: {
        organizationId,
        acceptedAt: null,
        expiresAt: { lte: now },
      },
    }),
    prisma.organizationInvitation.count({
      where: {
        organizationId,
        acceptedAt: { not: null },
      },
    }),
    prisma.organizationInvitation.findMany({
      where: {
        organizationId,
        acceptedAt: null,
      },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.conversationJob.count({
      where: {
        conversation: { organizationId },
        status: "QUEUED",
      },
    }),
    prisma.conversationJob.count({
      where: {
        conversation: { organizationId },
        status: "RUNNING",
      },
    }),
    prisma.conversationJob.count({
      where: {
        conversation: { organizationId },
        status: "RUNNING",
        OR: [
          { leaseExpiresAt: { lte: now } },
          { startedAt: { lte: staleJobCutoff } },
        ],
      },
    }),
    prisma.sessionPartJob.count({
      where: {
        sessionPart: {
          session: {
            organizationId,
          },
        },
        status: "QUEUED",
      },
    }),
    prisma.sessionPartJob.count({
      where: {
        sessionPart: {
          session: {
            organizationId,
          },
        },
        status: "RUNNING",
      },
    }),
    prisma.sessionPartJob.count({
      where: {
        sessionPart: {
          session: {
            organizationId,
          },
        },
        status: "RUNNING",
        startedAt: { lte: staleJobCutoff },
      },
    }),
    prisma.student.count({
      where: {
        organizationId,
        archivedAt: { not: null },
      },
    }),
    prisma.conversationJob.findMany({
      where: {
        conversation: {
          organizationId,
          deletedAt: null,
        },
        OR: [
          { status: { in: ["QUEUED", "RUNNING", "ERROR"] } },
          { nextRetryAt: { not: null } },
        ],
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 8,
      select: {
        id: true,
        conversationId: true,
        type: true,
        status: true,
        lastError: true,
        nextRetryAt: true,
        startedAt: true,
        finishedAt: true,
        updatedAt: true,
        leaseExpiresAt: true,
        conversation: {
          select: {
            sessionId: true,
            student: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    }),
    prisma.sessionPartJob.findMany({
      where: {
        status: { in: ["QUEUED", "RUNNING", "ERROR"] },
        sessionPart: {
          session: {
            organizationId,
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 8,
      select: {
        id: true,
        sessionPartId: true,
        type: true,
        status: true,
        lastError: true,
        startedAt: true,
        finishedAt: true,
        updatedAt: true,
        sessionPart: {
          select: {
            partType: true,
            fileName: true,
            session: {
              select: {
                id: true,
                student: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.conversationLog.findMany({
      where: {
        organizationId,
        deletedAt: { not: null },
      },
      orderBy: [{ deletedAt: "desc" }, { createdAt: "desc" }],
      take: 6,
      select: {
        id: true,
        studentId: true,
        deletedAt: true,
        deletedReason: true,
        deletedSessionId: true,
        student: {
          select: {
            name: true,
          },
        },
        deletedBy: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    }),
    prisma.report.findMany({
      where: {
        organizationId,
        deletedAt: { not: null },
      },
      orderBy: [{ deletedAt: "desc" }, { createdAt: "desc" }],
      take: 6,
      select: {
        id: true,
        studentId: true,
        deletedAt: true,
        deletedReason: true,
        student: {
          select: {
            name: true,
          },
        },
        deletedBy: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    }),
    prisma.auditLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        action: true,
        status: true,
        targetType: true,
        targetId: true,
        createdAt: true,
      },
      take: 8,
    }),
  ]);

  if (!organization) {
    return null;
  }

  const roleCounts = users.reduce<Record<string, number>>((acc, user) => {
    acc[user.role] = (acc[user.role] ?? 0) + 1;
    return acc;
  }, {});

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      planCode: organization.planCode,
      studentLimit: organization.studentLimit,
      defaultLocale: organization.defaultLocale,
      defaultTimeZone: organization.defaultTimeZone,
      guardianConsentRequired: organization.guardianConsentRequired,
      consentVersion: organization.consentVersion,
      consentUpdatedAt: organization.consentUpdatedAt?.toISOString() ?? null,
      createdAt: organization.createdAt.toISOString(),
      updatedAt: organization.updatedAt.toISOString(),
    },
    permissions: {
      viewerRole,
      canManage: canManageSettings(viewerRole),
      roleCounts,
      policyRows: [
        {
          label: "生徒の追加・編集・アーカイブ",
          roles: "Admin / Manager / Teacher / Instructor",
          note: "教室運営で必要な日常操作です。",
        },
        {
          label: "設定変更・招待・復元",
          roles: "Admin / Manager",
          note: "組織を壊しやすい操作は管理側だけに寄せます。",
        },
        {
          label: "保守 API・強い管理操作",
          roles: "Admin",
          note: "サービス全体を守る操作は最小人数に絞ります。",
        },
      ],
    },
    guardianContacts: {
      totalStudents,
      studentsWithGuardian,
      studentsMissingGuardian: Math.max(0, totalStudents - studentsWithGuardian),
      coveragePercent: totalStudents > 0 ? Math.round((studentsWithGuardian / totalStudents) * 100) : 0,
      missingStudents: missingGuardianStudents,
    },
    invitations: {
      pendingCount: pendingInvitations,
      expiredCount: expiredInvitations,
      acceptedCount: acceptedInvitations,
      recentPending: recentPendingInvitations.map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt.toISOString(),
      })),
    },
    operations: {
      queuedConversationJobs,
      runningConversationJobs,
      staleConversationJobs,
      queuedSessionPartJobs,
      runningSessionPartJobs,
      staleSessionPartJobs,
      archivedStudents,
      conversationJobRows: conversationJobRows.map((job) => ({
        id: job.id,
        kind: "conversation",
        targetId: job.conversationId,
        sessionId: job.conversation.sessionId ?? null,
        studentId: job.conversation.student.id,
        studentName: job.conversation.student.name ?? null,
        jobType: job.type,
        status: job.status,
        statusLabel: buildJobStatusLabel({
          status: job.status,
          nextRetryAt: job.nextRetryAt,
          now,
        }),
        fileName: null,
        partType: null,
        lastError: job.lastError ?? null,
        nextRetryAt: toIsoString(job.nextRetryAt),
        startedAt: toIsoString(job.startedAt),
        finishedAt: toIsoString(job.finishedAt),
        updatedAt: job.updatedAt.toISOString(),
        leaseExpiresAt: toIsoString(job.leaseExpiresAt),
      })),
      sessionPartJobRows: sessionPartJobRows.map((job) => ({
        id: job.id,
        kind: "session_part",
        targetId: job.sessionPartId,
        sessionId: job.sessionPart.session.id,
        studentId: job.sessionPart.session.student.id,
        studentName: job.sessionPart.session.student.name ?? null,
        jobType: job.type,
        status: job.status,
        statusLabel: buildJobStatusLabel({
          status: job.status,
          now,
        }),
        fileName: job.sessionPart.fileName ?? null,
        partType: job.sessionPart.partType,
        lastError: job.lastError ?? null,
        nextRetryAt: null,
        startedAt: toIsoString(job.startedAt),
        finishedAt: toIsoString(job.finishedAt),
        updatedAt: job.updatedAt.toISOString(),
        leaseExpiresAt: null,
      })),
      deletedConversations: deletedConversations
        .filter((item) => item.deletedAt)
        .map((item) => ({
          id: item.id,
          kind: "conversation",
          studentId: item.studentId,
          studentName: item.student.name ?? null,
          deletedAt: item.deletedAt!.toISOString(),
          deletedByLabel: pickDeletedByLabel(item.deletedBy),
          note: item.deletedReason ?? null,
          sessionId: item.deletedSessionId ?? null,
        })),
      deletedReports: deletedReports
        .filter((item) => item.deletedAt)
        .map((item) => ({
          id: item.id,
          kind: "report",
          studentId: item.studentId,
          studentName: item.student.name ?? null,
          deletedAt: item.deletedAt!.toISOString(),
          deletedByLabel: pickDeletedByLabel(item.deletedBy),
          note: item.deletedReason ?? null,
          sessionId: null,
        })),
      recentAuditLogs: recentAuditLogs.map((entry) => ({
        id: entry.id,
        action: entry.action,
        status: entry.status,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        createdAt: entry.createdAt.toISOString(),
      })),
    },
    sending: getSendingConfigSummary(),
    trust: getTrustPolicySummary(),
  };
}
