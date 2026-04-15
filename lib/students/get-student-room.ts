import { prisma } from "@/lib/db";
import { withVisibleReportWhere } from "@/lib/content-visibility";
import { runWithDatabaseRetry } from "@/lib/db-retry";
import { buildReportDeliverySummary } from "@/lib/report-delivery";
import { getRecordingLockView } from "@/lib/recording/lockService";
import { buildSessionProgressState } from "@/lib/session-progress";
import { withActiveStudentWhere } from "@/lib/students/student-lifecycle";
import { sanitizeReportMarkdown } from "@/lib/user-facing-japanese";

export type StudentRoomScope = "summary" | "full";

type GetStudentRoomOptions = {
  studentId: string;
  organizationId: string;
  viewerUserId?: string | null;
  scope?: StudentRoomScope;
};

type DetailedReportRecord = {
  id: string;
  reportMarkdown: string | null;
  deliveryEvents: Array<{
    id: string;
    eventType: string;
    deliveryChannel: string | null;
    note: string | null;
    createdAt: Date;
    actor: {
      id: string;
      name: string | null;
      email: string | null;
    } | null;
  }>;
};

type StudioConversationDetail = {
  artifactJson: unknown;
  summaryMarkdown: string | null;
};

function normalizeSourceLogIds(sourceLogIds: unknown): string[] | null {
  if (!Array.isArray(sourceLogIds)) return null;
  const normalized = sourceLogIds.filter((value): value is string => typeof value === "string" && value.length > 0);
  return normalized.length > 0 ? normalized : [];
}

function buildStudentRoomSelect(scope: StudentRoomScope) {
  const isFullRoom = scope === "full";

  if (!isFullRoom) {
    return {
      id: true,
      name: true,
      nameKana: true,
      grade: true,
      course: true,
      guardianNames: true,
      sessions: {
        orderBy: [{ sessionDate: "desc" as const }, { createdAt: "desc" as const }],
        take: 6,
        select: {
          id: true,
          type: true,
          status: true,
          sessionDate: true,
          heroStateLabel: true,
          heroOneLiner: true,
          latestSummary: true,
          conversation: {
            select: {
              id: true,
              status: true,
              createdAt: true,
              reviewState: true,
              summaryMarkdown: true,
            },
          },
          nextMeetingMemo: {
            select: {
              id: true,
              status: true,
              previousSummary: true,
              suggestedTopics: true,
              errorMessage: true,
              updatedAt: true,
              conversationId: true,
              sessionId: true,
            },
          },
        },
      },
      reports: {
        where: withVisibleReportWhere({}),
        orderBy: { createdAt: "desc" as const },
        take: 4,
        select: {
          id: true,
          status: true,
          createdAt: true,
          sentAt: true,
          reviewedAt: true,
          deliveryChannel: true,
          sourceLogIds: true,
          deliveryEvents: {
            orderBy: { createdAt: "desc" as const },
            take: 1,
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
          },
        },
      },
    };
  }

  return {
    id: true,
    name: true,
    nameKana: true,
    grade: true,
    course: true,
    guardianNames: true,
    sessions: {
      orderBy: [{ sessionDate: "desc" as const }, { createdAt: "desc" as const }],
      take: 12,
      select: {
        id: true,
        type: true,
        status: true,
        sessionDate: true,
        heroStateLabel: true,
        heroOneLiner: true,
        latestSummary: true,
        parts: {
          select: {
            id: true,
            partType: true,
            status: true,
            qualityMetaJson: true,
          },
          orderBy: { createdAt: "asc" as const },
        },
        conversation: {
          select: {
            id: true,
            status: true,
            createdAt: true,
            reviewState: true,
            qualityMetaJson: true,
            jobs: {
              select: {
                type: true,
                status: true,
                startedAt: true,
                finishedAt: true,
              },
            },
          },
        },
        nextMeetingMemo: {
          select: {
            id: true,
            status: true,
            previousSummary: true,
            suggestedTopics: true,
            errorMessage: true,
            updatedAt: true,
            conversationId: true,
            sessionId: true,
          },
        },
      },
    },
    reports: {
      where: withVisibleReportWhere({}),
      orderBy: { createdAt: "desc" as const },
      take: 6,
      select: {
        id: true,
        status: true,
        createdAt: true,
        sentAt: true,
        reviewedAt: true,
        deliveryChannel: true,
        sourceLogIds: true,
        deliveryEvents: {
          orderBy: { createdAt: "desc" as const },
          take: 1,
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
        },
      },
    },
  };
}

async function getLatestDetailedReport(reportId: string, organizationId: string) {
  return (await runWithDatabaseRetry("student-room-latest-report", () =>
    prisma.report.findFirst({
      where: withVisibleReportWhere({ id: reportId, organizationId }),
      select: {
        id: true,
        reportMarkdown: true,
        deliveryEvents: {
          orderBy: { createdAt: "asc" as const },
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
        },
      },
    })
  )) as DetailedReportRecord | null;
}

async function getStudioConversationDetails(sessionIds: string[], organizationId: string) {
  if (sessionIds.length === 0) {
    return new Map<string, StudioConversationDetail>();
  }

  const sessions = (await runWithDatabaseRetry("student-room-studio-sessions", () =>
    prisma.session.findMany({
      where: {
        id: { in: sessionIds },
        organizationId,
      },
      select: {
        id: true,
        conversation: {
          select: {
            artifactJson: true,
            summaryMarkdown: true,
          },
        },
      },
    })
  )) as Array<{ id: string; conversation: StudioConversationDetail | null }>;

  return new Map(
    sessions
      .filter((session) => Boolean(session.conversation))
      .map((session) => [session.id, session.conversation as StudioConversationDetail])
  );
}

export async function getStudentRoomData({
  studentId,
  organizationId,
  viewerUserId,
  scope = "full",
}: GetStudentRoomOptions) {
  const roomScope: StudentRoomScope = scope === "summary" ? "summary" : "full";
  const isFullRoom = roomScope === "full";

  const student = (await runWithDatabaseRetry("student-room", () =>
    prisma.student.findFirst({
      where: withActiveStudentWhere({ id: studentId, organizationId }),
      select: buildStudentRoomSelect(roomScope),
    })
  )) as any;

  if (!student) {
    return null;
  }

  const detailedSessionIds = isFullRoom
    ? (student.sessions ?? [])
        .filter((session: any) => session.type === "INTERVIEW" && session.conversation?.status === "DONE")
        .slice(0, 4)
        .map((session: any) => session.id)
    : [];

  const [latestDetailedReport, studioConversationDetails, recordingLock] = isFullRoom
    ? await Promise.all([
        student.reports?.[0]?.id
          ? getLatestDetailedReport(student.reports[0].id, organizationId)
          : Promise.resolve(null),
        getStudioConversationDetails(detailedSessionIds, organizationId),
        runWithDatabaseRetry("recording-lock-view", () =>
          getRecordingLockView({
            studentId: student.id,
            viewerUserId: viewerUserId ?? null,
          })
        ),
      ])
    : [null, new Map<string, StudioConversationDetail>(), null];

  const sessions = (student.sessions ?? []).map((session: any) => {
    const studioConversation = studioConversationDetails.get(session.id) ?? null;

    const conversation = session.conversation
      ? {
          id: session.conversation.id,
          status: session.conversation.status,
          createdAt: session.conversation.createdAt.toISOString(),
          reviewState: session.conversation.reviewState ?? null,
          qualityMetaJson: session.conversation.qualityMetaJson ?? null,
          summaryMarkdown: session.conversation.summaryMarkdown ?? studioConversation?.summaryMarkdown ?? null,
          ...(isFullRoom ? { artifactJson: studioConversation?.artifactJson ?? null } : {}),
          jobs: session.conversation.jobs ?? [],
        }
      : null;

    const pipeline = isFullRoom
      ? buildSessionProgressState({
          sessionId: session.id,
          type: session.type,
          parts: session.parts ?? [],
          conversation: session.conversation,
        })
      : undefined;

    return {
      id: session.id,
      type: session.type,
      status: session.status,
      sessionDate: session.sessionDate.toISOString(),
      heroStateLabel: session.heroStateLabel,
      heroOneLiner: session.heroOneLiner,
      latestSummary: session.latestSummary,
      parts: [],
      pipeline,
      nextMeetingMemo: session.nextMeetingMemo
        ? {
            ...session.nextMeetingMemo,
            updatedAt: session.nextMeetingMemo.updatedAt?.toISOString() ?? null,
          }
        : null,
      conversation,
    };
  });

  const latestConversation = sessions.find((session: any) => Boolean(session.conversation))?.conversation ?? null;

  const reports = (student.reports ?? []).map((report: any, index: number) => {
    const detailedReport =
      isFullRoom && index === 0 && latestDetailedReport?.id === report.id ? latestDetailedReport : null;
    const deliveryEvents = detailedReport?.deliveryEvents ?? report.deliveryEvents ?? [];
    const mappedReport = {
      ...report,
      reportMarkdown: detailedReport ? sanitizeReportMarkdown(detailedReport.reportMarkdown ?? "") : "",
      createdAt: report.createdAt.toISOString(),
      sentAt: report.sentAt?.toISOString() ?? null,
      reviewedAt: report.reviewedAt?.toISOString() ?? null,
      sourceLogIds: normalizeSourceLogIds(report.sourceLogIds),
      deliveryEvents: deliveryEvents.map((event: any) => ({
        ...event,
        createdAt: event.createdAt.toISOString(),
      })),
    };

    return {
      ...mappedReport,
      ...buildReportDeliverySummary(mappedReport),
    };
  });

  return {
    meta: { scope: roomScope },
    student: {
      id: student.id,
      name: student.name,
      nameKana: student.nameKana ?? null,
      grade: student.grade,
      course: student.course ?? null,
      guardianNames: student.guardianNames ?? null,
      profiles: [],
    },
    latestConversation: latestConversation
      ? {
          id: latestConversation.id,
          status: latestConversation.status,
          createdAt: latestConversation.createdAt,
        }
      : null,
    latestProfile: null,
    sessions,
    reports,
    ...(recordingLock ? { recordingLock } : {}),
  };
}
