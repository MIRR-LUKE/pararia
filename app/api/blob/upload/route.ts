import { NextResponse } from "next/server";
import { handleUpload } from "@vercel/blob/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { API_THROTTLE_RULES, ApiQuotaExceededError, consumeApiQuota } from "@/lib/api-throttle";
import {
  ALLOWED_AUDIO_CONTENT_TYPES,
  BLOB_UPLOAD_MAX_BYTES,
  markBlobUploadReservationCompleted,
  parseBlobUploadReservationRequest,
  upsertBlobUploadReservation,
} from "@/lib/blob-upload-reservations";
import { requireAuthorizedSession } from "@/lib/server/request-auth";
import { RequestValidationError, parseJsonWithSchema, parseWithSchema } from "@/lib/server/request-validation";

export const runtime = "nodejs";

const blobUploadEventSchema = z.object({
  type: z.enum(["blob.generate-client-token", "blob.upload-completed"]),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const blobUploadCompletionPayloadSchema = z.object({
  pathname: z.string().trim().min(1),
});

export async function POST(request: Request) {
  let authorizedSession: Awaited<ReturnType<typeof requireAuthorizedSession>>["session"] | null = null;

  try {
    const body = await parseJsonWithSchema(request, blobUploadEventSchema, "Blob アップロード");

    if (body.type === "blob.generate-client-token") {
      const authResult = await requireAuthorizedSession();
      if (authResult.response) return authResult.response;
      authorizedSession = authResult.session;
    }

    const result = await handleUpload({
      request,
      body: body as any,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!authorizedSession) {
          throw new RequestValidationError("ログインが切れています。もう一度お試しください。", 401);
        }

        const reservationRequest = parseBlobUploadReservationRequest(pathname, clientPayload);
        const sessionRow = await prisma.session.findUnique({
          where: { id: reservationRequest.sessionId },
          select: {
            id: true,
            organizationId: true,
            studentId: true,
          },
        });
        if (!sessionRow || sessionRow.organizationId !== authorizedSession.user.organizationId) {
          throw new RequestValidationError("対象セッションが見つかりません。", 404);
        }

        await consumeApiQuota({
          scope: "blob_upload:user",
          rawKey: authorizedSession.user.id,
          bytes: reservationRequest.uploadedByteSize,
          rule: API_THROTTLE_RULES.blobUploadUser,
        });
        await consumeApiQuota({
          scope: "blob_upload:org",
          rawKey: authorizedSession.user.organizationId,
          bytes: reservationRequest.uploadedByteSize,
          rule: API_THROTTLE_RULES.blobUploadOrg,
        });

        const reservation = await upsertBlobUploadReservation({
          organizationId: authorizedSession.user.organizationId,
          studentId: sessionRow.studentId,
          sessionId: sessionRow.id,
          partType: reservationRequest.partType,
          pathname: reservationRequest.pathname,
          uploadedByUserId: authorizedSession.user.id,
          uploadSource: reservationRequest.uploadSource,
          expectedFileName: reservationRequest.uploadedFileName,
          expectedMimeType: reservationRequest.uploadedMimeType,
          expectedByteSize: reservationRequest.uploadedByteSize,
        });

        return {
          allowedContentTypes: [...ALLOWED_AUDIO_CONTENT_TYPES],
          maximumSizeInBytes: BLOB_UPLOAD_MAX_BYTES,
          validUntil: Date.now() + 60 * 60 * 1000,
          addRandomSuffix: false,
          allowOverwrite: false,
          tokenPayload: JSON.stringify({ pathname: reservation.pathname }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const payload = parseWithSchema(
          blobUploadCompletionPayloadSchema,
          tokenPayload ? JSON.parse(tokenPayload) : {},
          "Blob 完了通知"
        );
        const blobSize = (blob as typeof blob & { size?: number }).size;
        await markBlobUploadReservationCompleted({
          pathname: payload.pathname,
          blobUrl: blob.url,
          blobDownloadUrl: blob.downloadUrl,
          blobContentType: blob.contentType,
          blobByteSize: typeof blobSize === "number" ? blobSize : null,
        });
      },
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[POST /api/blob/upload] Error:", error);

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

    return NextResponse.json(
      { error: error?.message ?? "Blob upload token generation failed." },
      { status: 400 }
    );
  }
}
