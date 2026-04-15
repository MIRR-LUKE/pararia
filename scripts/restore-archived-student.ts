import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../lib/db";
import { writeAuditLog } from "../lib/audit";
import { restoreArchivedStudent } from "../lib/students/student-lifecycle";
import { loadBackupEnv } from "./lib/load-backup-env";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");

function getArgValue(flag: string) {
  const index = process.argv.findIndex((value) => value === flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

async function main() {
  await loadBackupEnv(ROOT);

  const studentId = getArgValue("--student-id");
  if (!studentId) {
    throw new Error("--student-id が必要です。");
  }

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      name: true,
      organizationId: true,
      archivedAt: true,
    },
  });
  if (!student) {
    throw new Error(`student not found: ${studentId}`);
  }
  if (!student.archivedAt) {
    console.log(
      JSON.stringify(
        {
          studentId: student.id,
          name: student.name,
          status: "already-active",
        },
        null,
        2
      )
    );
    return;
  }

  const restored = await restoreArchivedStudent({
    studentId: student.id,
    organizationId: student.organizationId,
  });
  if (!restored) {
    throw new Error(`archived student not found for restore: ${studentId}`);
  }

  await writeAuditLog({
    organizationId: restored.student.organizationId,
    action: "student.restore.script",
    targetType: "student",
    targetId: restored.student.id,
    detail: {
      studentId: restored.student.id,
      studentName: restored.student.name,
      archiveSnapshotId: restored.latestSnapshotId,
    },
  });

  console.log(
    JSON.stringify(
      {
        studentId: restored.student.id,
        name: restored.student.name,
        archiveSnapshotId: restored.latestSnapshotId,
        restoredAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("[restore-archived-student] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
