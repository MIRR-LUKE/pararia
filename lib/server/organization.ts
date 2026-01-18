import { prisma } from "@/lib/db";
import { DEFAULT_ORGANIZATION_ID, DEFAULT_ORGANIZATION_NAME } from "@/lib/constants";

export async function ensureOrganizationId(requestedId?: string | null) {
  const id = requestedId || DEFAULT_ORGANIZATION_ID;
  const existing = await prisma.organization.findUnique({
    where: { id },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.organization.create({
    data: {
      id,
      name: DEFAULT_ORGANIZATION_NAME,
    },
    select: { id: true },
  });
  return created.id;
}
