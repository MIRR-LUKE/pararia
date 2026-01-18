import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { User } from "@prisma/client";

const SALT_ROUNDS = 10;

export type SessionUser = Pick<
  User,
  "id" | "email" | "name" | "role" | "organizationId"
>;

export async function hashPassword(password: string) {
  const salt = await bcrypt.genSalt(SALT_ROUNDS);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
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
