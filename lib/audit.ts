import { prisma } from "@/lib/db";

export type AuditLogInput = {
  userId?: string | null;
  action: string;
  detail?: Record<string, unknown> | null;
};

function formatAuditDetail(detail: Record<string, unknown> | null | undefined) {
  if (!detail || Object.keys(detail).length === 0) {
    return "";
  }

  try {
    return `:${JSON.stringify(detail).slice(0, 420)}`;
  } catch (error) {
    console.error("[audit] failed to serialize audit detail", {
      error,
      detailKeys: Object.keys(detail),
    });
    return ":<unserializable>";
  }
}

export async function writeAuditLog(input: AuditLogInput) {
  try {
    const suffix = formatAuditDetail(input.detail);
    await prisma.auditLog.create({
      data: {
        userId: input.userId ?? undefined,
        action: `${input.action}${suffix}`.slice(0, 500),
      },
    });
  } catch (error) {
    console.error("[audit] failed to write audit log", {
      error,
      action: input.action,
      userId: input.userId ?? null,
    });
  }
}
