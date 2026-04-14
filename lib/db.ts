import { PrismaClient } from "@prisma/client";
import { resolvePrismaDatasourceUrl } from "@/lib/db-url";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const resolvedDatasourceUrl = resolvePrismaDatasourceUrl();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    ...(resolvedDatasourceUrl
      ? {
          datasources: {
            db: {
              url: resolvedDatasourceUrl,
            },
          },
        }
      : {}),
  });

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = prisma;
}
