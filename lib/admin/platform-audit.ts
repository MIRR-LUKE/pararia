import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { toPrismaJson } from "@/lib/prisma-json";

export type PlatformAuditStatus = "SUCCESS" | "ERROR" | "DENIED" | "CANCELLED" | "PREPARED";
export type PlatformAuditRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type PlatformAuditRequestMeta = {
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type PlatformAuditTarget = {
  type?: string | null;
  id?: string | null;
  organizationId?: string | null;
};

export type PlatformAuditLogInput = {
  actorOperatorId?: string | null;
  action: string;
  status?: PlatformAuditStatus;
  reason?: string | null;
  riskLevel?: PlatformAuditRiskLevel;
  target?: PlatformAuditTarget | null;
  request?: PlatformAuditRequestMeta | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export type PlatformWriteActionDraft = {
  action: string;
  riskLevel: PlatformAuditRiskLevel;
  target: PlatformAuditTarget;
  reasonRequired: true;
  confirmationItems: string[];
};

function hashMetadata(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) return null;
  return createHash("sha256").update(normalized).digest("hex");
}

function normalizeReason(reason: string | null | undefined) {
  const normalized = reason?.trim();
  return normalized ? normalized.slice(0, 1000) : null;
}

export function createPlatformWriteActionDraft(input: {
  action: string;
  target: PlatformAuditTarget;
  riskLevel?: PlatformAuditRiskLevel;
  confirmationItems?: string[];
}): PlatformWriteActionDraft {
  return {
    action: input.action,
    target: input.target,
    riskLevel: input.riskLevel ?? "HIGH",
    reasonRequired: true,
    confirmationItems: input.confirmationItems ?? [],
  };
}

export async function writePlatformAuditLog(input: PlatformAuditLogInput) {
  try {
    await prisma.platformAuditLog.create({
      data: {
        actorOperatorId: input.actorOperatorId ?? undefined,
        action: input.action.slice(0, 500),
        status: input.status ?? "SUCCESS",
        reason: normalizeReason(input.reason) ?? undefined,
        riskLevel: input.riskLevel ?? "LOW",
        targetType: input.target?.type ?? undefined,
        targetId: input.target?.id ?? undefined,
        targetOrganizationId: input.target?.organizationId ?? undefined,
        requestId: input.request?.requestId ?? undefined,
        requestIpHash: hashMetadata(input.request?.ipAddress) ?? undefined,
        userAgentHash: hashMetadata(input.request?.userAgent) ?? undefined,
        beforeJson: toPrismaJson(input.before),
        afterJson: toPrismaJson(input.after),
        metadataJson: toPrismaJson(input.metadata),
      },
    });
    return true;
  } catch (error) {
    console.error("[platform-audit] failed to write audit log", {
      error,
      action: input.action,
      actorOperatorId: input.actorOperatorId ?? null,
      targetType: input.target?.type ?? null,
      targetId: input.target?.id ?? null,
      targetOrganizationId: input.target?.organizationId ?? null,
    });
    return false;
  }
}

export async function writePreparedPlatformActionAudit(input: Omit<PlatformAuditLogInput, "status">) {
  return writePlatformAuditLog({
    ...input,
    status: "PREPARED",
    metadata: {
      ...(input.metadata ?? {}),
      dangerousOperationExecuted: false,
    },
  });
}
