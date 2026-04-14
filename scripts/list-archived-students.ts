import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../lib/db";
import { loadBackupEnv } from "./lib/load-backup-env";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");

async function main() {
  await loadBackupEnv(ROOT);

  const archivedStudents = await prisma.student.findMany({
    where: {
      archivedAt: {
        not: null,
      },
    },
    select: {
      id: true,
      organizationId: true,
      name: true,
      archivedAt: true,
      archiveReason: true,
    },
    orderBy: [{ archivedAt: "desc" }, { createdAt: "desc" }],
  });

  console.log(
    JSON.stringify(
      archivedStudents.map((student) => ({
        id: student.id,
        organizationId: student.organizationId,
        name: student.name,
        archivedAt: student.archivedAt?.toISOString() ?? null,
        archiveReason: student.archiveReason ?? null,
      })),
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("[list-archived-students] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
