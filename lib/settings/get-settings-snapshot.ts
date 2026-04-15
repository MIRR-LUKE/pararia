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
    recentAuditLogs,
  ] = await Promise.all([
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
