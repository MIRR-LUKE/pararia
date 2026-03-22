import { prisma } from "@/lib/db";

export async function writeAuditLog(input: {
  userId?: string | null;
  action: string;
  detail?: Record<string, unknown> | null;
}) {
  const suffix =
    input.detail && Object.keys(input.detail).length > 0
      ? `:${JSON.stringify(input.detail).slice(0, 420)}`
      : "";
  await prisma.auditLog.create({
    data: {
      userId: input.userId ?? undefined,
      action: `${input.action}${suffix}`.slice(0, 500),
    },
  });
}
