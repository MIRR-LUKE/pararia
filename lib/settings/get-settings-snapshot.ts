import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
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
    createdAt: string;
    updatedAt: string;
  };
  permissions: {
    viewerRole?: string;
    canManage: boolean;
    roleCounts: Record<string, number>;
  };
  guardianContacts: {
    totalStudents: number;
    studentsWithGuardian: number;
    studentsMissingGuardian: number;
    coveragePercent: number;
    missingStudents: MissingStudent[];
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

export function canManageSettings(role: string | undefined) {
  return role === UserRole.ADMIN || role === UserRole.MANAGER || role === "ADMIN" || role === "MANAGER";
}

export async function getSettingsSnapshot({
  organizationId,
  viewerRole,
}: GetSettingsSnapshotOptions): Promise<SettingsSnapshot | null> {
  const [organization, users, totalStudents, studentsWithGuardian, missingGuardianStudents] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
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
      createdAt: organization.createdAt.toISOString(),
      updatedAt: organization.updatedAt.toISOString(),
    },
    permissions: {
      viewerRole,
      canManage: canManageSettings(viewerRole),
      roleCounts,
    },
    guardianContacts: {
      totalStudents,
      studentsWithGuardian,
      studentsMissingGuardian: Math.max(0, totalStudents - studentsWithGuardian),
      coveragePercent: totalStudents > 0 ? Math.round((studentsWithGuardian / totalStudents) * 100) : 0,
      missingStudents: missingGuardianStudents,
    },
    sending: getSendingConfigSummary(),
    trust: getTrustPolicySummary(),
  };
}
