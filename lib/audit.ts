import { prisma } from "@/lib/db";

export async function writeAuditLog(input: {
  userId?: string | null;
  action: string;
  detail?: Record<string, unknown> | null;
}) {
  let suffix = "";
  if (input.detail && Object.keys(input.detail).length > 0) {
    try {
      suffix = `:${JSON.stringify(input.detail).slice(0, 420)}`;
    } catch (error) {
      console.error("[writeAuditLog] failed to serialize detail:", error);
    }
  }

  try {
    await prisma.auditLog.create({
      data: {
        userId: input.userId ?? undefined,
        action: `${input.action}${suffix}`.slice(0, 500),
      },
    });
  } catch (error) {
    console.error("[writeAuditLog] failed to persist audit log:", error);
  }
}
