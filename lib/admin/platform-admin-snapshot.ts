import { TeacherAppDeviceStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  type AdminCampusDetail,
  type AdminCampusListResult,
  type AdminCampusStatus,
  type AdminCampusSummary,
  type PlatformAdminSnapshot,
  type PlatformOperatorContext,
} from "./platform-admin-types";
import { type CampusMetrics, createEmptyMetrics, getCampusMetrics } from "./platform-admin-campus-metrics";
import { getCrossCampusJobHealth } from "./platform-admin-jobs";
import { assertPlatformAdminReadable } from "./platform-operators";

const DEFAULT_TAKE = 100;
const MAX_TAKE = 500;

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

function toCampusSummary(input: {
  organization: {
    id: string;
    name: string;
    planCode: string;
    contractStatus: string;
    contractRenewalDate: Date | null;
    csOwnerName: string | null;
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
    contractStatus: input.organization.contractStatus,
    contractRenewalDate: toIsoString(input.organization.contractRenewalDate),
    csOwnerName: input.organization.csOwnerName,
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
      { contractStatus: { contains: normalizedQuery, mode: "insensitive" } },
      { billingContactName: { contains: normalizedQuery, mode: "insensitive" } },
      { billingContactEmail: { contains: normalizedQuery, mode: "insensitive" } },
      { salesOwnerName: { contains: normalizedQuery, mode: "insensitive" } },
      { csOwnerName: { contains: normalizedQuery, mode: "insensitive" } },
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
      contractStatus: true,
      contractRenewalDate: true,
      billingContactName: true,
      billingContactEmail: true,
      salesOwnerName: true,
      csOwnerName: true,
      usageLimitNote: true,
      supportNote: true,
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

export async function getAdminCampusDetail(options: GetAdminCampusDetailOptions): Promise<AdminCampusDetail | null> {
  if (options.operator !== undefined) assertPlatformAdminReadable(options.operator);

  const now = new Date();
  const organization = await prisma.organization.findUnique({
    where: { id: options.organizationId },
    select: {
      id: true,
      name: true,
      planCode: true,
      contractStatus: true,
      contractRenewalDate: true,
      billingContactName: true,
      billingContactEmail: true,
      salesOwnerName: true,
      csOwnerName: true,
      usageLimitNote: true,
      supportNote: true,
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
    contract: {
      status: organization.contractStatus,
      renewalDate: toIsoString(organization.contractRenewalDate),
      billingContactName: organization.billingContactName,
      billingContactEmail: organization.billingContactEmail,
      salesOwnerName: organization.salesOwnerName,
      csOwnerName: organization.csOwnerName,
      usageLimitNote: organization.usageLimitNote,
      supportNote: organization.supportNote,
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
