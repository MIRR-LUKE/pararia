import { Prisma, TeacherRecordingSessionStatus } from "@prisma/client";

export class TeacherRecordingStatusTransitionError extends Error {
  status = 409;

  constructor(message: string) {
    super(message);
    this.name = "TeacherRecordingStatusTransitionError";
  }
}

const ALLOWED_TRANSITIONS: Record<TeacherRecordingSessionStatus, ReadonlySet<TeacherRecordingSessionStatus>> = {
  [TeacherRecordingSessionStatus.RECORDING]: new Set([
    TeacherRecordingSessionStatus.TRANSCRIBING,
    TeacherRecordingSessionStatus.CANCELLED,
  ]),
  [TeacherRecordingSessionStatus.TRANSCRIBING]: new Set([
    TeacherRecordingSessionStatus.AWAITING_STUDENT_CONFIRMATION,
    TeacherRecordingSessionStatus.ERROR,
  ]),
  [TeacherRecordingSessionStatus.AWAITING_STUDENT_CONFIRMATION]: new Set([
    TeacherRecordingSessionStatus.STUDENT_CONFIRMED,
    TeacherRecordingSessionStatus.ERROR,
  ]),
  [TeacherRecordingSessionStatus.STUDENT_CONFIRMED]: new Set(),
  [TeacherRecordingSessionStatus.CANCELLED]: new Set(),
  [TeacherRecordingSessionStatus.ERROR]: new Set(),
};

export function canTransitionTeacherRecordingStatus(
  from: TeacherRecordingSessionStatus,
  to: TeacherRecordingSessionStatus
) {
  return ALLOWED_TRANSITIONS[from]?.has(to) ?? false;
}

export function assertTeacherRecordingStatusTransition(
  from: TeacherRecordingSessionStatus,
  to: TeacherRecordingSessionStatus
) {
  if (from === to) return;
  if (!canTransitionTeacherRecordingStatus(from, to)) {
    throw new TeacherRecordingStatusTransitionError(
      `Teacher録音の状態は ${from} から ${to} へ変更できません。`
    );
  }
}

export async function updateTeacherRecordingStatus(
  tx: Prisma.TransactionClient,
  input: {
    recordingId: string;
    from: TeacherRecordingSessionStatus;
    to: TeacherRecordingSessionStatus;
    where?: Prisma.TeacherRecordingSessionWhereInput;
    data?: Omit<Prisma.TeacherRecordingSessionUncheckedUpdateManyInput, "status">;
  }
) {
  assertTeacherRecordingStatusTransition(input.from, input.to);
  const updated = await tx.teacherRecordingSession.updateMany({
    where: {
      id: input.recordingId,
      status: input.from,
      ...(input.where ?? {}),
    },
    data: {
      ...(input.data ?? {}),
      status: input.to,
    },
  });
  if (updated.count === 0) {
    throw new TeacherRecordingStatusTransitionError(
      "Teacher録音の状態を更新できませんでした。最新の状態を確認してください。"
    );
  }
  return updated;
}
