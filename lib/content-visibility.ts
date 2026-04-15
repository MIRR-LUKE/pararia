import type { Prisma } from "@prisma/client";

export function withVisibleConversationWhere(
  where: Prisma.ConversationLogWhereInput
): Prisma.ConversationLogWhereInput {
  return {
    ...where,
    deletedAt: null,
  };
}

export function withVisibleReportWhere(where: Prisma.ReportWhereInput): Prisma.ReportWhereInput {
  return {
    ...where,
    deletedAt: null,
  };
}
