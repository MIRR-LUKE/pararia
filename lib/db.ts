import { PrismaClient } from "@prisma/client";
import { normalizePrismaDatabaseUrl } from "@/lib/db-url";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const normalizedDatasourceUrl = normalizePrismaDatabaseUrl(process.env.DATABASE_URL);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    ...(normalizedDatasourceUrl
      ? {
          datasources: {
            db: {
              url: normalizedDatasourceUrl,
            },
          },
        }
      : {}),
  });

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = prisma;
}
