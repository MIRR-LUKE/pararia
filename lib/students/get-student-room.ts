import { prisma } from "@/lib/db";
import { runWithDatabaseRetry } from "@/lib/db-retry";
import { buildReportDeliverySummary } from "@/lib/report-delivery";
import { getRecordingLockView } from "@/lib/recording/lockService";
import { buildSessionProgressState } from "@/lib/session-progress";
import { sanitizeReportMarkdown } from "@/lib/user-facing-japanese";

export type StudentRoomScope = "summary" | "full";

type GetStudentRoomOptions = {
  studentId: string;
  organizationId: string;
  viewerUserId?: string | null;
  scope?: StudentRoomScope;
};

function normalizeSourceLogIds(sourceLogIds: unknown): string[] | null {
  if (!Array.isArray(sourceLogIds)) return null;
  const normalized = sourceLogIds.filter((value): value is string => typeof value === "string" && value.length > 0);
  return normalized.length > 0 ? normalized : [];
}

function buildStudentRoomSelect(scope: StudentRoomScope) {
  const isFullRoom = scope === "full";

  return {
    id: true,
    name: true,
    grade: true,
    course: true,
    guardianNames: true,
    ...(isFullRoom
      ? {
          profiles: {
            orderBy: { createdAt: "desc" as const },
            take: 1,
            select: {
              id: true,
              profileData: true,
              createdAt: true,
            },
          },
        }
      : {}),
    sessions: {
      orderBy: [{ sessionDate: "desc" as const }, { createdAt: "desc" as const }],
      take: isFullRoom ? 12 : 8,
      select: {
        id: true,
        type: true,
        status: true,
        title: true,
        sessionDate: true,
        heroStateLabel: true,
        heroOneLiner: true,
        latestSummary: true,
        parts: {
          select: {
            id: true,
            partType: true,
            status: true,
            fileName: true,
            reviewState: true,
            qualityMetaJson: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" as const },
        },
        conversation: {
          select: {
            id: true,
            status: true,
            reviewState: true,
            createdAt: true,
            ...(isFullRoom
              ? {
                  artifactJson: true,
                  summaryMarkdown: true,
                }
              : {}),
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
      orderBy: { createdAt: "desc" as const },
      take: isFullRoom ? 6 : 4,
      select: {
        id: true,
        status: true,
        createdAt: true,
        sentAt: true,
        reviewedAt: true,
        deliveryChannel: true,
        sourceLogIds: true,
        ...(isFullRoom
          ? {
              reportMarkdown: true,
              qualityChecksJson: true,
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
            }
          : {
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
            }),
      },
    },
  };
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
      where: { id: studentId, organizationId },
      select: buildStudentRoomSelect(roomScope),
    })
  )) as any;

  if (!student) {
    return null;
  }

  const sessions = (student.sessions ?? []).map((session: any) => {
    const parts = (session.parts ?? []).map((part: any) => ({
      id: part.id,
      partType: part.partType,
      status: part.status,
      fileName: part.fileName,
      reviewState: part.reviewState,
      qualityMetaJson: part.qualityMetaJson,
      createdAt: part.createdAt.toISOString(),
    }));

    const conversation = session.conversation
      ? {
          id: session.conversation.id,
          status: session.conversation.status,
          reviewState: session.conversation.reviewState,
          createdAt: session.conversation.createdAt.toISOString(),
          ...(isFullRoom
            ? {
                artifactJson: session.conversation.artifactJson ?? null,
                summaryMarkdown: session.conversation.summaryMarkdown ?? null,
              }
            : {}),
          jobs: session.conversation.jobs ?? [],
        }
      : null;

    const pipeline = buildSessionProgressState({
      sessionId: session.id,
      type: session.type,
      parts: session.parts,
      conversation: session.conversation,
    });

    return {
      id: session.id,
      type: session.type,
      status: session.status,
      title: session.title,
      sessionDate: session.sessionDate.toISOString(),
      heroStateLabel: session.heroStateLabel,
      heroOneLiner: session.heroOneLiner,
      latestSummary: session.latestSummary,
      parts,
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

  const recordingLock = await runWithDatabaseRetry("recording-lock-view", () =>
    getRecordingLockView({
      studentId: student.id,
      viewerUserId: viewerUserId ?? null,
    })
  );

  const latestProfileRecord = student.profiles?.[0] ?? null;

  return {
    meta: { scope: roomScope },
    student: {
      id: student.id,
      name: student.name,
      grade: student.grade,
      course: student.course,
      guardianNames: student.guardianNames,
      profiles: isFullRoom
        ? (student.profiles ?? []).map((profile: any) => ({
            ...profile,
            createdAt: profile.createdAt.toISOString(),
          }))
        : [],
    },
    latestConversation: latestConversation
      ? {
          id: latestConversation.id,
          status: latestConversation.status,
          reviewState: latestConversation.reviewState,
          createdAt: latestConversation.createdAt,
        }
      : null,
    latestProfile:
      isFullRoom && latestProfileRecord
        ? {
            ...latestProfileRecord,
            createdAt: latestProfileRecord.createdAt.toISOString(),
          }
        : null,
    sessions,
    reports: (student.reports ?? []).map((report: any) => ({
      ...report,
      reportMarkdown: isFullRoom ? sanitizeReportMarkdown(report.reportMarkdown ?? "") : "",
      createdAt: report.createdAt.toISOString(),
      sentAt: report.sentAt?.toISOString() ?? null,
      reviewedAt: report.reviewedAt?.toISOString() ?? null,
      qualityChecksJson:
        isFullRoom && report.qualityChecksJson && typeof report.qualityChecksJson === "object"
          ? (report.qualityChecksJson as any)
          : null,
      sourceLogIds: normalizeSourceLogIds(report.sourceLogIds),
      deliveryEvents: (report.deliveryEvents ?? []).map((event: any) => ({
        ...event,
        createdAt: event.createdAt.toISOString(),
      })),
      ...buildReportDeliverySummary(report),
    })),
    recordingLock,
  };
}
