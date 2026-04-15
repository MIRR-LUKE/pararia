import { prisma } from "@/lib/db";
import { toPrismaJson } from "@/lib/prisma-json";

export type AuditLogInput = {
  organizationId?: string | null;
  userId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  status?: "SUCCESS" | "ERROR" | "DENIED";
  detail?: Record<string, unknown> | null;
};

export async function writeAuditLog(input: AuditLogInput) {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: input.organizationId ?? undefined,
        userId: input.userId ?? undefined,
        action: input.action.slice(0, 500),
        targetType: input.targetType ?? undefined,
        targetId: input.targetId ?? undefined,
        status: input.status ?? "SUCCESS",
        detailJson: toPrismaJson(input.detail),
      },
    });
  } catch (error) {
    console.error("[audit] failed to write audit log", {
      error,
      action: input.action,
      organizationId: input.organizationId ?? null,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      userId: input.userId ?? null,
    });
  }
}
