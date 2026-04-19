import { createHmac, timingSafeEqual } from "node:crypto";
import { requireEnvValue } from "@/lib/env";
import { roleLabelJa } from "@/lib/permissions";
import type { SessionUser } from "@/lib/auth";
import type { TeacherAppDeviceSession } from "./types";

const TEACHER_APP_COOKIE_NAME = "pararia_teacher_device";
const TEACHER_APP_TOKEN_VERSION = 1;
const TEACHER_APP_TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000;

type TeacherAppCookie = {
  name: string;
  value: string;
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
};

type TeacherAppTokenPayload = TeacherAppDeviceSession & {
  kind: "teacher_app_device";
  version: number;
};

function base64UrlEncode(input: string | Buffer) {
  return Buffer.from(input).toString("base64url");
}

function base64UrlDecode(input: string) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function getTeacherAppSigningSecret() {
  return requireEnvValue(["AUTH_SECRET", "NEXTAUTH_SECRET"], "Teacher App token secret");
}

function signTokenSegment(value: string) {
  return createHmac("sha256", getTeacherAppSigningSecret()).update(value).digest();
}

export function createTeacherAppDeviceSession(user: SessionUser, deviceLabel: string): TeacherAppDeviceSession {
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + TEACHER_APP_TOKEN_TTL_MS);
  return {
    userId: user.id,
    organizationId: user.organizationId,
    role: user.role,
    roleLabel: roleLabelJa(user.role),
    userName: user.name ?? null,
    userEmail: user.email ?? null,
    deviceLabel: deviceLabel.trim(),
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

export function serializeTeacherAppSessionToken(session: TeacherAppDeviceSession) {
  const header = base64UrlEncode(
    JSON.stringify({
      alg: "HS256",
      typ: "PARARIA_TEACHER_DEVICE",
    })
  );
  const payload = base64UrlEncode(
    JSON.stringify({
      kind: "teacher_app_device",
      version: TEACHER_APP_TOKEN_VERSION,
      ...session,
    } satisfies TeacherAppTokenPayload)
  );
  const signed = `${header}.${payload}`;
  const signature = signTokenSegment(signed).toString("base64url");
  return `${signed}.${signature}`;
}

export function parseTeacherAppSessionToken(token: string | null | undefined): TeacherAppDeviceSession | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  const signed = `${header}.${payload}`;
  const expectedSignature = signTokenSegment(signed);
  const actualSignature = Buffer.from(signature, "base64url");

  if (expectedSignature.length !== actualSignature.length) {
    return null;
  }
  if (!timingSafeEqual(expectedSignature, actualSignature)) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as Partial<TeacherAppTokenPayload>;
    if (parsed.kind !== "teacher_app_device" || parsed.version !== TEACHER_APP_TOKEN_VERSION) {
      return null;
    }
    if (
      typeof parsed.userId !== "string" ||
      typeof parsed.organizationId !== "string" ||
      typeof parsed.role !== "string" ||
      typeof parsed.roleLabel !== "string" ||
      typeof parsed.deviceLabel !== "string" ||
      typeof parsed.issuedAt !== "string" ||
      typeof parsed.expiresAt !== "string"
    ) {
      return null;
    }
    const expiresAt = Date.parse(parsed.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return null;
    }
    return {
      userId: parsed.userId,
      organizationId: parsed.organizationId,
      role: parsed.role,
      roleLabel: parsed.roleLabel,
      userName: typeof parsed.userName === "string" ? parsed.userName : null,
      userEmail: typeof parsed.userEmail === "string" ? parsed.userEmail : null,
      deviceLabel: parsed.deviceLabel,
      issuedAt: parsed.issuedAt,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

export function buildTeacherAppSessionCookie(token: string): TeacherAppCookie {
  return {
    name: TEACHER_APP_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(TEACHER_APP_TOKEN_TTL_MS / 1000),
  };
}

export function buildTeacherAppSessionCookieClear(): TeacherAppCookie {
  return {
    name: TEACHER_APP_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  };
}

export function getTeacherAppCookieName() {
  return TEACHER_APP_COOKIE_NAME;
}
