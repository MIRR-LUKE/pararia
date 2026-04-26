import { NextResponse } from "next/server";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { z } from "zod";
import { API_THROTTLE_RULES, ApiQuotaExceededError, consumeApiQuota } from "@/lib/api-throttle";
import { ALLOWED_AUDIO_CONTENT_TYPES, BLOB_UPLOAD_MAX_BYTES } from "@/lib/blob-upload-reservations";
import { checkAudioBlobWriteHealth } from "@/lib/audio-storage-health";
import { getAudioStorageAccess } from "@/lib/audio-storage";
import { resolveRouteId, type RouteParams } from "@/lib/server/route-params";
import { requireTeacherAppMutationSession } from "@/lib/server/teacher-app-session";
import { RequestValidationError, parseJsonWithSchema } from "@/lib/server/request-validation";
import { prepareTeacherRecordingBlobUpload } from "@/lib/teacher-app/server/recordings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const BLOB_API_VERSION = "12";
const BLOB_API_URL = "https://vercel.com/api/blob";
const CLIENT_TOKEN_TTL_MS = 60 * 60 * 1000;
const MULTIPART_PART_SIZE_BYTES = 8 * 1024 * 1024;
const MULTIPART_MIN_PART_SIZE_BYTES = 5 * 1024 * 1024;

const blobTokenRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().max(191).optional().nullable(),
  byteSize: z.number().int().nonnegative().max(BLOB_UPLOAD_MAX_BYTES),
  durationSecondsHint: z.number().nonnegative().finite().optional().nullable(),
});

export async function POST(request: Request, { params }: { params: RouteParams }) {
  try {
    const authResult = await requireTeacherAppMutationSession(request);
    if (authResult.response) return authResult.response;

    const recordingId = await resolveRouteId(params);
    if (!recordingId) {
      return NextResponse.json({ error: "recordingId が必要です。" }, { status: 400 });
    }

    const blobHealth = await checkAudioBlobWriteHealth();
    if (!blobHealth.ok) {
      return NextResponse.json(
        {
          error: blobHealth.message,
          code: blobHealth.code,
        },
        { status: 503 }
      );
    }

    const body = await parseJsonWithSchema(request, blobTokenRequestSchema, "Teacher App Blob アップロード");
    const contentType = body.mimeType?.trim() || "audio/mp4";

    await consumeApiQuota({
      scope: "teacher_recording_upload:user",
      rawKey: authResult.session.userId,
      bytes: body.byteSize,
      rule: API_THROTTLE_RULES.teacherRecordingUploadUser,
    });
    await consumeApiQuota({
      scope: "teacher_recording_upload:org",
      rawKey: authResult.session.organizationId,
      bytes: body.byteSize,
      rule: API_THROTTLE_RULES.teacherRecordingUploadOrg,
    });

    const prepared = await prepareTeacherRecordingBlobUpload({
      organizationId: authResult.session.organizationId,
      deviceId: authResult.session.deviceId,
      deviceLabel: authResult.session.deviceLabel,
      recordingId,
      fileName: body.fileName,
    });

    const access = getAudioStorageAccess();
    const clientToken = await generateClientTokenFromReadWriteToken({
      pathname: prepared.storagePathname,
      allowedContentTypes: [...ALLOWED_AUDIO_CONTENT_TYPES],
      maximumSizeInBytes: BLOB_UPLOAD_MAX_BYTES,
      validUntil: Date.now() + CLIENT_TOKEN_TTL_MS,
      addRandomSuffix: false,
      allowOverwrite: false,
    });

    return NextResponse.json({
      clientToken,
      pathname: prepared.storagePathname,
      fileName: prepared.safeFileName,
      access,
      contentType,
      apiUrl: process.env.NEXT_PUBLIC_VERCEL_BLOB_API_URL || process.env.VERCEL_BLOB_API_URL || BLOB_API_URL,
      apiVersion: process.env.NEXT_PUBLIC_VERCEL_BLOB_API_VERSION_OVERRIDE || process.env.VERCEL_BLOB_API_VERSION_OVERRIDE || BLOB_API_VERSION,
      partSizeBytes: MULTIPART_PART_SIZE_BYTES,
      minimumPartSizeBytes: MULTIPART_MIN_PART_SIZE_BYTES,
      maximumSizeInBytes: BLOB_UPLOAD_MAX_BYTES,
    });
  } catch (error: any) {
    console.error("[POST /api/teacher/recordings/[id]/audio/blob-token] Error:", error);

    if (error instanceof RequestValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof ApiQuotaExceededError) {
      return NextResponse.json(
        {
          error: error.message,
          retryAfterSeconds: error.retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(error.retryAfterSeconds),
          },
        }
      );
    }

    return NextResponse.json({ error: error?.message ?? "Blob upload token generation failed." }, { status: 400 });
  }
}
