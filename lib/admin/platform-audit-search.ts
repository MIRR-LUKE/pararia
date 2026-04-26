import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { PlatformOperatorContext } from "./platform-admin-types";
import { writePlatformAuditLog } from "./platform-audit";

export type PlatformAuditSearchFilters = {
  from?: string | null;
  to?: string | null;
  operator?: string | null;
  campus?: string | null;
  action?: string | null;
  status?: string | null;
  take?: number | null;
  skip?: number | null;
};

export type PlatformAuditSearchRow = {
  id: string;
  operator: {
    email: string | null;
    name: string | null;
  };
  target: {
    type: string | null;
    id: string | null;
    organizationId: string | null;
    organizationName: string | null;
  };
  action: string;
  status: string;
  reason: string | null;
  risk: string;
  createdAt: string;
};

export type PlatformAuditSearchResult = {
  logs: PlatformAuditSearchRow[];
  totalCount: number;
  page: {
    take: number;
    skip: number;
    hasMore: boolean;
  };
  defaultImportantOnly: boolean;
};

export type PlatformAuditExportFormat = "csv" | "json";

const MAX_SEARCH_TAKE = 100;
const DEFAULT_SEARCH_TAKE = 20;
const MAX_EXPORT_TAKE = 1000;
const IMPORTANT_RISK_LEVELS = ["MEDIUM", "HIGH", "CRITICAL"];
const IMPORTANT_STATUSES = ["ERROR", "DENIED", "CANCELLED", "PREPARED"];

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeDate(value: string | null | undefined, boundary: "from" | "to") {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const date = new Date(boundary === "to" && /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? `${normalized}T23:59:59.999Z` : normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeTake(value: number | null | undefined, max: number) {
  if (!value || !Number.isFinite(value)) return DEFAULT_SEARCH_TAKE;
  return Math.min(Math.max(Math.floor(value), 1), max);
}

function normalizeSkip(value: number | null | undefined) {
  if (!value || !Number.isFinite(value)) return 0;
  return Math.max(Math.floor(value), 0);
}

function hasActiveFilter(filters: PlatformAuditSearchFilters) {
  return Boolean(
    normalizeText(filters.from) ||
      normalizeText(filters.to) ||
      normalizeText(filters.operator) ||
      normalizeText(filters.campus) ||
      normalizeText(filters.action) ||
      normalizeText(filters.status)
  );
}

async function resolveCampusFilter(campus: string | null): Promise<string[] | undefined> {
  if (!campus) return undefined;

  const organizations = await prisma.organization.findMany({
    where: {
      OR: [{ id: campus }, { name: { contains: campus, mode: "insensitive" } }],
    },
    select: { id: true },
    take: 50,
  });

  const organizationIds = new Set(organizations.map((organization) => organization.id));
  organizationIds.add(campus);
  return Array.from(organizationIds);
}

async function buildPlatformAuditWhere(filters: PlatformAuditSearchFilters) {
  const from = normalizeDate(filters.from, "from");
  const to = normalizeDate(filters.to, "to");
  const operator = normalizeText(filters.operator);
  const campus = normalizeText(filters.campus);
  const action = normalizeText(filters.action);
  const status = normalizeText(filters.status);
  const defaultImportantOnly = !hasActiveFilter(filters);
  const where: Prisma.PlatformAuditLogWhereInput = {};

  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }

  if (operator) {
    where.actorOperator = {
      OR: [
        { email: { contains: operator, mode: "insensitive" } },
        { displayName: { contains: operator, mode: "insensitive" } },
      ],
    };
  }

  if (campus) {
    where.targetOrganizationId = { in: await resolveCampusFilter(campus) };
  }

  if (action) {
    where.action = { contains: action, mode: "insensitive" };
  }

  if (status) {
    where.status = status.toUpperCase();
  }

  if (defaultImportantOnly) {
    where.OR = [
      { riskLevel: { in: IMPORTANT_RISK_LEVELS } },
      { status: { in: IMPORTANT_STATUSES } },
      { action: { contains: "export", mode: "insensitive" } },
    ];
  }

  return { where, defaultImportantOnly };
}

async function attachOrganizationNames(rows: Array<{ targetOrganizationId: string | null }>) {
  const organizationIds = Array.from(new Set(rows.map((row) => row.targetOrganizationId).filter(Boolean))) as string[];
  if (organizationIds.length === 0) return new Map<string, string>();

  const organizations = await prisma.organization.findMany({
    where: { id: { in: organizationIds } },
    select: { id: true, name: true },
  });
  return new Map(organizations.map((organization) => [organization.id, organization.name]));
}

async function runPlatformAuditSearch(
  filters: PlatformAuditSearchFilters,
  maxTake: number
): Promise<PlatformAuditSearchResult> {
  const take = normalizeTake(filters.take, maxTake);
  const skip = normalizeSkip(filters.skip);
  const { where, defaultImportantOnly } = await buildPlatformAuditWhere(filters);

  const [totalCount, rows] = await Promise.all([
    prisma.platformAuditLog.count({ where }),
    prisma.platformAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        action: true,
        status: true,
        reason: true,
        riskLevel: true,
        targetType: true,
        targetId: true,
        targetOrganizationId: true,
        createdAt: true,
        actorOperator: {
          select: {
            email: true,
            displayName: true,
          },
        },
      },
    }),
  ]);

  const organizationNames = await attachOrganizationNames(rows);

  return {
    logs: rows.map((row) => ({
      id: row.id,
      operator: {
        email: row.actorOperator?.email ?? null,
        name: row.actorOperator?.displayName ?? null,
      },
      target: {
        type: row.targetType,
        id: row.targetId,
        organizationId: row.targetOrganizationId,
        organizationName: row.targetOrganizationId ? organizationNames.get(row.targetOrganizationId) ?? null : null,
      },
      action: row.action,
      status: row.status,
      reason: row.reason,
      risk: row.riskLevel,
      createdAt: row.createdAt.toISOString(),
    })),
    totalCount,
    page: {
      take,
      skip,
      hasMore: skip + rows.length < totalCount,
    },
    defaultImportantOnly,
  };
}

export async function searchPlatformAuditLogs(filters: PlatformAuditSearchFilters): Promise<PlatformAuditSearchResult> {
  return runPlatformAuditSearch(filters, MAX_SEARCH_TAKE);
}

function escapeCsvCell(value: string | null | undefined) {
  const text = value ?? "";
  return `"${text.replace(/"/g, '""')}"`;
}

export function renderPlatformAuditCsv(rows: PlatformAuditSearchRow[]) {
  const header = ["createdAt", "operatorName", "operatorEmail", "campus", "action", "status", "reason", "risk", "targetType", "targetId"];
  const lines = rows.map((row) =>
    [
      row.createdAt,
      row.operator.name,
      row.operator.email,
      row.target.organizationName ?? row.target.organizationId,
      row.action,
      row.status,
      row.reason,
      row.risk,
      row.target.type,
      row.target.id,
    ]
      .map(escapeCsvCell)
      .join(",")
  );
  return `${header.join(",")}\n${lines.join("\n")}\n`;
}

export async function exportPlatformAuditLogs(input: {
  filters: PlatformAuditSearchFilters;
  format: PlatformAuditExportFormat;
  operator: PlatformOperatorContext;
  request?: {
    requestId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  };
}) {
  const result = await runPlatformAuditSearch({
    ...input.filters,
    skip: 0,
    take: normalizeTake(input.filters.take, MAX_EXPORT_TAKE),
  }, MAX_EXPORT_TAKE);

  await writePlatformAuditLog({
    actorOperatorId: input.operator.id.startsWith("env:") ? null : input.operator.id,
    action: "platform_audit_export",
    status: "SUCCESS",
    reason: "監査ログのエクスポート",
    riskLevel: "MEDIUM",
    target: { type: "PlatformAuditLog" },
    request: input.request,
    metadata: {
      format: input.format,
      rowCount: result.logs.length,
      filters: {
        from: normalizeText(input.filters.from),
        to: normalizeText(input.filters.to),
        operator: normalizeText(input.filters.operator),
        campus: normalizeText(input.filters.campus),
        action: normalizeText(input.filters.action),
        status: normalizeText(input.filters.status),
      },
    },
  });

  return result.logs;
}
