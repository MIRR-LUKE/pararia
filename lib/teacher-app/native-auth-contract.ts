import { z } from "zod";
import type { TeacherAppClientInfo } from "@/lib/teacher-app/types";

const trimmedNullableString = z
  .string()
  .trim()
  .max(64)
  .optional()
  .transform((value) => (value ? value : null));

export const teacherAppClientInfoSchema = z
  .object({
    platform: z.enum(["IOS", "ANDROID", "WEB", "UNKNOWN"]).default("UNKNOWN"),
    appVersion: trimmedNullableString,
    buildNumber: trimmedNullableString,
  })
  .default({
    platform: "UNKNOWN",
    appVersion: null,
    buildNumber: null,
  });

export const teacherNativeDeviceLoginBodySchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(256),
  deviceLabel: z.string().trim().min(2).max(60),
  client: teacherAppClientInfoSchema,
});

export const teacherNativeRefreshBodySchema = z.object({
  refreshToken: z.string().trim().min(16).max(512),
  client: teacherAppClientInfoSchema.optional(),
});

export const teacherNativeNotificationRegistrationBodySchema = z.object({
  provider: z.enum(["FCM"]).default("FCM"),
  token: z.string().trim().min(32).max(4096),
  permissionStatus: z.enum(["granted", "denied", "unknown"]).default("unknown"),
});

export function normalizeTeacherAppClientInfo(value: TeacherAppClientInfo): TeacherAppClientInfo {
  return {
    platform: value.platform,
    appVersion: value.appVersion?.trim() || null,
    buildNumber: value.buildNumber?.trim() || null,
  };
}
