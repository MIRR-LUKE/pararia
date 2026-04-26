import { PlatformRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/permissions";
import type { PlatformAdminPermissionSet, PlatformOperatorContext } from "./platform-admin-types";

export type PlatformRoleInput = string | null | undefined;

const PLATFORM_ROLES = new Set<string>(Object.values(PlatformRole));

const READ_ALL_CAMPUS_ROLES = new Set<PlatformRole>([
  PlatformRole.PLATFORM_OWNER,
  PlatformRole.OPS_ADMIN,
  PlatformRole.SUPPORT_LEAD,
  PlatformRole.CUSTOMER_SUCCESS,
  PlatformRole.READONLY_AUDITOR,
  PlatformRole.ENGINEER_ONCALL,
]);

const WRITE_PREP_ROLES = new Set<PlatformRole>([
  PlatformRole.PLATFORM_OWNER,
  PlatformRole.OPS_ADMIN,
  PlatformRole.SUPPORT_LEAD,
  PlatformRole.ENGINEER_ONCALL,
]);

const DANGEROUS_ACTION_ROLES = new Set<PlatformRole>([
  PlatformRole.PLATFORM_OWNER,
  PlatformRole.OPS_ADMIN,
  PlatformRole.ENGINEER_ONCALL,
]);

export function normalizePlatformRole(role: PlatformRoleInput): PlatformRole | null {
  const normalized = typeof role === "string" ? role.trim().toUpperCase() : "";
  if (!normalized || !PLATFORM_ROLES.has(normalized)) return null;
  return normalized as PlatformRole;
}

export function getPlatformAdminPermissions(role: PlatformRoleInput): PlatformAdminPermissionSet {
  const normalized = normalizePlatformRole(role);
  return {
    canReadAllCampuses: normalized ? READ_ALL_CAMPUS_ROLES.has(normalized) : false,
    canReadAuditLogs: normalized
      ? normalized === PlatformRole.PLATFORM_OWNER || normalized === PlatformRole.READONLY_AUDITOR
      : false,
    canPrepareWriteActions: normalized ? WRITE_PREP_ROLES.has(normalized) : false,
    canExecuteDangerousActions: normalized ? DANGEROUS_ACTION_ROLES.has(normalized) : false,
    canManagePlatformOperators: normalized === PlatformRole.PLATFORM_OWNER,
  };
}

export function canReadPlatformAdmin(role: PlatformRoleInput) {
  return getPlatformAdminPermissions(role).canReadAllCampuses;
}

export function canPreparePlatformWriteAction(role: PlatformRoleInput) {
  return getPlatformAdminPermissions(role).canPrepareWriteActions;
}

export async function getActivePlatformOperatorByEmail(email: string | null | undefined) {
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!normalizedEmail) return null;

  const operator = await prisma.platformOperator.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      displayName: true,
      role: true,
      disabledAt: true,
    },
  });

  if (!operator || operator.disabledAt) return null;

  return {
    id: operator.id,
    role: operator.role,
    displayName: operator.displayName ?? null,
    permissions: getPlatformAdminPermissions(operator.role),
  } satisfies PlatformOperatorContext;
}

function normalizeEmail(email: string | null | undefined) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function readLegacyAdminOperatorEmailSet() {
  const raw = process.env.PARARIA_ADMIN_OPERATOR_EMAILS?.trim();
  if (!raw) return null;
  return new Set(
    raw
      .split(",")
      .map((email) => normalizeEmail(email))
      .filter(Boolean)
  );
}

export async function resolvePlatformOperatorForSession(input: {
  email?: string | null;
  role?: string | null;
}): Promise<PlatformOperatorContext | null> {
  const email = normalizeEmail(input.email);
  if (!email) return null;

  const dbOperator = await getActivePlatformOperatorByEmail(email);
  if (dbOperator) {
    await prisma.platformOperator
      .update({
        where: { id: dbOperator.id },
        data: { lastSignedInAt: new Date() },
      })
      .catch(() => null);
    return dbOperator;
  }

  const legacyAllowlist = readLegacyAdminOperatorEmailSet();
  if (legacyAllowlist?.has(email) && isAdminRole(input.role)) {
    const role = PlatformRole.PLATFORM_OWNER;
    return {
      id: `env:${email}`,
      role,
      displayName: email,
      permissions: getPlatformAdminPermissions(role),
    };
  }

  return null;
}

export function assertPlatformAdminReadable(operator: PlatformOperatorContext | null) {
  if (!operator?.permissions.canReadAllCampuses) {
    throw new Error("platform admin operator permission is required");
  }
}
