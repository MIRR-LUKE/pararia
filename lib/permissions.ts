import { UserRole } from "@prisma/client";

export type RoleInput = string | null | undefined;

const KNOWN_ROLES = new Set<string>(Object.values(UserRole));

export function normalizeUserRole(role: RoleInput): UserRole | null {
  const normalized = typeof role === "string" ? role.trim().toUpperCase() : "";
  if (!normalized || !KNOWN_ROLES.has(normalized)) {
    return null;
  }
  return normalized as UserRole;
}

export function isAdminRole(role: RoleInput) {
  return normalizeUserRole(role) === UserRole.ADMIN;
}

export function isManagerRole(role: RoleInput) {
  return normalizeUserRole(role) === UserRole.MANAGER;
}

export function canManageStaff(role: RoleInput) {
  const normalized = normalizeUserRole(role);
  return normalized === UserRole.ADMIN || normalized === UserRole.MANAGER;
}

export function canManageInvitations(role: RoleInput) {
  return canManageStaff(role);
}

export function canManageSettings(role: RoleInput) {
  return canManageStaff(role);
}

export function canRestoreStudent(role: RoleInput) {
  return canManageStaff(role);
}

export function canForceReleaseRecordingLock(role: RoleInput) {
  return canManageStaff(role);
}

export function canRunMaintenanceRoutes(role: RoleInput) {
  return isAdminRole(role);
}

export function roleLabelJa(role: RoleInput) {
  const normalized = normalizeUserRole(role);
  if (normalized === UserRole.ADMIN) return "管理者";
  if (normalized === UserRole.MANAGER) return "室長";
  if (normalized === UserRole.TEACHER) return "講師";
  if (normalized === UserRole.INSTRUCTOR) return "講師";
  return "不明";
}
