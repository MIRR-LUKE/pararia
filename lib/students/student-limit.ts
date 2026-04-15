import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const STUDENT_LIMIT_TRANSACTION_RETRIES = 2;

export class StudentLimitExceededError extends Error {
  activeStudentCount: number;
  studentLimit: number;

  constructor(activeStudentCount: number, studentLimit: number) {
    super(
      `在籍中の生徒数が上限に達しています。現在 ${activeStudentCount} 人、上限 ${studentLimit} 人です。上限を増やすか、アーカイブ後に再実行してください。`
    );
    this.name = "StudentLimitExceededError";
    this.activeStudentCount = activeStudentCount;
    this.studentLimit = studentLimit;
  }
}

function isSerializableTransactionRetryable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\bP2034\b/i.test(message) || /could not serialize access/i.test(message);
}

type StudentLimitClient = Prisma.TransactionClient;

export async function assertStudentCapacityAvailable(tx: StudentLimitClient, organizationId: string) {
  const [organization, activeStudentCount] = await Promise.all([
    tx.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        studentLimit: true,
      },
    }),
    tx.student.count({
      where: {
        organizationId,
        archivedAt: null,
      },
    }),
  ]);

  if (!organization) {
    throw new Error("organization not found");
  }

  if (organization.studentLimit !== null && activeStudentCount >= organization.studentLimit) {
    throw new StudentLimitExceededError(activeStudentCount, organization.studentLimit);
  }

  return {
    activeStudentCount,
    studentLimit: organization.studentLimit,
    remainingSeats:
      organization.studentLimit === null ? null : Math.max(0, organization.studentLimit - activeStudentCount - 1),
  };
}

export async function runStudentCapacityWrite<T>(label: string, operation: (tx: StudentLimitClient) => Promise<T>) {
  let attempt = 0;
  while (true) {
    try {
      return await prisma.$transaction(
        async (tx) => operation(tx),
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        }
      );
    } catch (error) {
      if (attempt >= STUDENT_LIMIT_TRANSACTION_RETRIES || !isSerializableTransactionRetryable(error)) {
        throw error;
      }
      attempt += 1;
      console.warn(`[student-limit:${label}] concurrent write detected, retrying (${attempt})`);
    }
  }
}
