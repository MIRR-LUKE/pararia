import { NextResponse } from "next/server";
import { SessionPartType, SessionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAuthorizedSession } from "@/lib/server/request-auth";

export type SessionPartAuthSession = {
  user: {
    id: string;
    organizationId: string;
  };
};

export type SessionPartAccessContext = {
  sessionAuth: SessionPartAuthSession;
  sessionRow: {
    id: string;
    studentId: string;
    type: SessionType;
    student: {
      id: string;
      organizationId: string;
    };
  };
};

export type SessionPartSubmissionFormData = {
  partType: SessionPartType;
  transcript: string;
  file: File | null;
  blobUrl: string;
  uploadedFileName: string;
  uploadedMimeType: string;
  uploadedByteSize: number | null;
  durationSecondsHint: number | null;
  lockToken: string;
  uploadSource: "file_upload" | "direct_recording";
  hasBlobUpload: boolean;
};

export type LiveChunkSubmissionFormData = {
  partType: SessionPartType;
  file: File | null;
  lockToken: string;
  sequence: number;
  startedAtMs: number;
  durationMs: number;
};

export type LiveFinalizeSubmissionBody = {
  partType: SessionPartType;
  lockToken: string;
};

export function parsePartType(raw: string | null) {
  if (raw === SessionPartType.CHECK_IN) return SessionPartType.CHECK_IN;
  if (raw === SessionPartType.CHECK_OUT) return SessionPartType.CHECK_OUT;
  if (raw === SessionPartType.TEXT_NOTE) return SessionPartType.TEXT_NOTE;
  return SessionPartType.FULL;
}

export function parseSessionPartSubmissionFormData(formData: FormData): SessionPartSubmissionFormData {
  const blobUrl = (formData.get("blobUrl") as string | null)?.trim() ?? "";
  const uploadedFileName = (formData.get("fileName") as string | null)?.trim() ?? "";
  const uploadedMimeType = (formData.get("blobContentType") as string | null)?.trim() ?? "";
  const uploadedByteSize = Number(formData.get("blobSize") ?? NaN);
  const durationSecondsHintRaw = Number(formData.get("durationSecondsHint") ?? NaN);
  const durationSecondsHint =
    Number.isFinite(durationSecondsHintRaw) && durationSecondsHintRaw >= 0 ? durationSecondsHintRaw : null;
  const uploadSource = ((formData.get("uploadSource") as string | null)?.trim() || "file_upload") as
    | "file_upload"
    | "direct_recording";

  return {
    partType: parsePartType((formData.get("partType") as string | null) ?? null),
    transcript: (formData.get("transcript") as string | null)?.trim() ?? "",
    file: formData.get("file") as File | null,
    blobUrl,
    uploadedFileName,
    uploadedMimeType,
    uploadedByteSize: Number.isFinite(uploadedByteSize) && uploadedByteSize >= 0 ? uploadedByteSize : null,
    durationSecondsHint,
    lockToken: (formData.get("lockToken") as string | null)?.trim() ?? "",
    uploadSource,
    hasBlobUpload: Boolean(blobUrl),
  };
}

export function parseLiveChunkSubmissionFormData(formData: FormData): LiveChunkSubmissionFormData {
  return {
    partType: parsePartType((formData.get("partType") as string | null) ?? null),
    file: formData.get("file") as File | null,
    lockToken: (formData.get("lockToken") as string | null)?.trim() ?? "",
    sequence: Number(formData.get("sequence") ?? -1),
    startedAtMs: Number(formData.get("startedAtMs") ?? 0),
    durationMs: Number(formData.get("durationMs") ?? 0),
  };
}

export function parseLiveFinalizeSubmissionBody(body: unknown): LiveFinalizeSubmissionBody {
  const data = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  return {
    partType: parsePartType(typeof data.partType === "string" ? data.partType : null),
    lockToken: String(data.lockToken ?? "").trim(),
  };
}

export async function loadAuthorizedSessionPartContext(sessionId: string): Promise<
  | { response: NextResponse }
  | SessionPartAccessContext
> {
  const authResult = await requireAuthorizedSession();
  if (authResult.response) return authResult;

  const sessionRow = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      student: { select: { id: true, organizationId: true } },
    },
  });

  if (!sessionRow || sessionRow.student.organizationId !== authResult.session.user.organizationId) {
    return { response: NextResponse.json({ error: "セッションが見つかりません。" }, { status: 404 }) };
  }

  return {
    sessionAuth: authResult.session,
    sessionRow,
  };
}
