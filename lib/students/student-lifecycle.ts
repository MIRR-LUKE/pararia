import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export function withActiveStudentWhere(where: Prisma.StudentWhereInput): Prisma.StudentWhereInput {
  return {
    ...where,
    archivedAt: null,
  };
}

export function withArchivedStudentWhere(where: Prisma.StudentWhereInput): Prisma.StudentWhereInput {
  return {
    ...where,
    archivedAt: {
      not: null,
    },
  };
}

function toJsonValue<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

type ArchiveStudentInput = {
  studentId: string;
  organizationId: string;
  actorUserId?: string | null;
  reason?: string | null;
};

type RestoreStudentInput = {
  studentId: string;
  organizationId: string;
};

export async function archiveStudent(input: ArchiveStudentInput) {
  const archivedAt = new Date();

  return prisma.$transaction(async (tx) => {
    const student = await tx.student.findFirst({
      where: withActiveStudentWhere({
        id: input.studentId,
        organizationId: input.organizationId,
      }),
      include: {
        profiles: {
          orderBy: { createdAt: "desc" },
        },
        sessions: {
          orderBy: [{ sessionDate: "desc" }, { createdAt: "desc" }],
          include: {
            parts: {
              orderBy: { createdAt: "asc" },
              include: {
                jobs: {
                  orderBy: { createdAt: "asc" },
                },
              },
            },
            conversation: {
              include: {
                jobs: {
                  orderBy: { createdAt: "asc" },
                },
              },
            },
            nextMeetingMemo: true,
          },
        },
        conversations: {
          orderBy: { createdAt: "desc" },
          include: {
            jobs: {
              orderBy: { createdAt: "asc" },
            },
            nextMeetingMemo: true,
          },
        },
        reports: {
          orderBy: { createdAt: "desc" },
          include: {
            deliveryEvents: {
              orderBy: { createdAt: "asc" },
            },
          },
        },
        reportDeliveryEvents: {
          orderBy: { createdAt: "asc" },
        },
        recordingLock: true,
        nextMeetingMemos: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!student) {
      return null;
    }

    const runtimePaths = student.sessions
      .flatMap((session) => session.parts.map((part) => part.storageUrl))
      .filter((value): value is string => typeof value === "string" && value.length > 0);

    const snapshot = await tx.studentArchiveSnapshot.create({
      data: {
        organizationId: student.organizationId,
        studentId: student.id,
        studentName: student.name,
        archivedByUserId: input.actorUserId ?? null,
        reason: input.reason ?? "manual_archive",
        runtimePathsJson: toJsonValue(runtimePaths),
        snapshotJson: toJsonValue({
          schemaVersion: 1,
          archivedAt,
          student,
        }),
      },
    });

    await tx.studentRecordingLock.deleteMany({
      where: {
        studentId: student.id,
      },
    });

    const archivedStudent = await tx.student.update({
      where: {
        id: student.id,
      },
      data: {
        archivedAt,
        archivedByUserId: input.actorUserId ?? null,
        archiveReason: input.reason ?? "manual_archive",
      },
    });

    return {
      student: archivedStudent,
      snapshotId: snapshot.id,
      runtimePaths,
      counts: {
        sessions: student.sessions.length,
        reports: student.reports.length,
        conversations: student.conversations.length,
        profiles: student.profiles.length,
        deliveryEvents: student.reportDeliveryEvents.length,
      },
    };
  });
}

export async function restoreArchivedStudent(input: RestoreStudentInput) {
  return prisma.$transaction(async (tx) => {
    const student = await tx.student.findFirst({
      where: withArchivedStudentWhere({
        id: input.studentId,
        organizationId: input.organizationId,
      }),
      select: {
        id: true,
        name: true,
        archivedAt: true,
      },
    });

    if (!student) {
      return null;
    }

    const latestSnapshot = await tx.studentArchiveSnapshot.findFirst({
      where: {
        organizationId: input.organizationId,
        studentId: input.studentId,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
      },
    });

    const restoredStudent = await tx.student.update({
      where: {
        id: input.studentId,
      },
      data: {
        archivedAt: null,
        archivedByUserId: null,
        archiveReason: null,
      },
    });

    return {
      student: restoredStudent,
      latestSnapshotId: latestSnapshot?.id ?? null,
      latestSnapshotCreatedAt: latestSnapshot?.createdAt ?? null,
    };
  });
}
