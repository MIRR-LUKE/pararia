import { NextResponse } from "next/server";
import { requireAuthorizedSession } from "@/lib/server/request-auth";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import { maybeEnsureRunpodWorker } from "@/lib/runpod/worker-control";

export const runtime = "nodejs";

const MAX_AUDIO_UPLOAD_BYTES = 512 * 1024 * 1024;
const ALLOWED_AUDIO_CONTENT_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
  "audio/webm",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
  "audio/flac",
];

type GenerateBlobClientTokenRequest = {
  type: "blob.generate-client-token";
  payload?: {
    pathname?: string;
  };
};

export async function POST(request: Request) {
  try {
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;

    const body = (await request.json()) as GenerateBlobClientTokenRequest;
    const pathname = body?.payload?.pathname?.trim() ?? "";
    if (body?.type !== "blob.generate-client-token" || !pathname.startsWith("session-audio/uploads/")) {
      return NextResponse.json({ error: "audio upload path is invalid" }, { status: 400 });
    }

    if (!shouldRunBackgroundJobsInline()) {
      void maybeEnsureRunpodWorker()
        .then((workerWake) => {
          if (workerWake.attempted && !workerWake.ok) {
            console.error("[POST /api/blob/upload] Runpod worker wake failed:", workerWake);
          }
        })
        .catch((error) => {
          console.error("[POST /api/blob/upload] Runpod worker wake crashed:", error);
        });
    }

    const { generateClientTokenFromReadWriteToken } = await import("@vercel/blob/client");
    const clientToken = await generateClientTokenFromReadWriteToken({
      pathname,
      allowedContentTypes: ALLOWED_AUDIO_CONTENT_TYPES,
      maximumSizeInBytes: MAX_AUDIO_UPLOAD_BYTES,
      validUntil: Date.now() + 60 * 60 * 1000,
      addRandomSuffix: false,
      allowOverwrite: false,
    });

    return NextResponse.json({
      type: "blob.generate-client-token",
      clientToken,
    });
  } catch (error: any) {
    console.error("[POST /api/blob/upload] Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Blob upload token generation failed." },
      { status: 400 }
    );
  }
}
