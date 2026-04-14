import { compare, hash } from "@node-rs/bcrypt";
import { prisma } from "./db";
import { User } from "@prisma/client";

const SALT_ROUNDS = 10;

export type SessionUser = Pick<
  User,
  "id" | "email" | "name" | "role" | "organizationId"
>;

export async function hashPassword(password: string) {
  return hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string) {
  return compare(password, hash);
}

export async function loginWithEmail(
  email: string,
  password: string
): Promise<SessionUser | null> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return null;

  return sanitizeUser(user);
}

export function sanitizeUser(user: User): SessionUser {
  const { id, email, name, role, organizationId } = user;
  return { id, email, name, role, organizationId };
}
