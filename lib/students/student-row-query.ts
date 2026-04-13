import type { Prisma } from "@prisma/client";

export type StudentRowProjection = "report" | "directory" | "dashboard";

const studentBaseSelect = {
  id: true,
  name: true,
  nameKana: true,
  grade: true,
  course: true,
  guardianNames: true,
  profiles: {
    select: {
      profileData: true,
    },
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
  sessions: {
    select: {
      id: true,
      status: true,
      type: true,
      sessionDate: true,
      heroStateLabel: true,
      heroOneLiner: true,
      latestSummary: true,
      conversation: {
        select: {
          id: true,
        },
      },
    },
    orderBy: [{ sessionDate: "desc" as const }, { createdAt: "desc" as const }],
    take: 1,
  },
} satisfies Prisma.StudentSelect;

const directoryReportSelect = {
  id: true,
  status: true,
  createdAt: true,
  reviewedAt: true,
  sentAt: true,
  deliveryEvents: {
    select: {
      eventType: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
} satisfies Prisma.ReportSelect;

const dashboardReportSelect = {
  id: true,
  status: true,
  createdAt: true,
  reviewedAt: true,
  sentAt: true,
  deliveryEvents: {
    select: {
      eventType: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
} satisfies Prisma.ReportSelect;

const reportReportSelect = {
  id: true,
  status: true,
  createdAt: true,
  reviewedAt: true,
  sentAt: true,
  deliveryChannel: true,
  sourceLogIds: true,
  deliveryEvents: {
    select: {
      id: true,
      eventType: true,
      deliveryChannel: true,
      note: true,
      createdAt: true,
      actor: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
} satisfies Prisma.ReportSelect;

export function buildStudentRowSelect(projection: StudentRowProjection): Prisma.StudentSelect {
  const reportSelect =
    projection === "report"
      ? reportReportSelect
      : projection === "dashboard"
        ? dashboardReportSelect
        : directoryReportSelect;

  return {
    ...studentBaseSelect,
    reports: {
      select: reportSelect,
      orderBy: { createdAt: "desc" as const },
      take: 1,
    },
    ...(projection === "directory"
      ? {
          _count: {
            select: { sessions: true, reports: true },
          },
        }
      : {}),
  };
}
