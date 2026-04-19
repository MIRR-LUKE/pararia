import { SESSION_PART_UPLOAD_PART_TYPES, SESSION_PART_UPLOAD_PATH_PREFIX, type SessionPartUploadPartType } from "@/lib/blob-upload-client-payload";

function sanitizeSegment(value: string) {
  return String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-");
}

export function sanitizeStorageFileName(fileName: string) {
  const raw = String(fileName || "audio.bin").trim();
  const base = raw.split(/[\\/]/).pop() || "audio.bin";
  return sanitizeSegment(base || "audio.bin");
}

export function joinStoragePath(...segments: string[]) {
  return segments
    .filter(Boolean)
    .map((segment) => sanitizeSegment(segment))
    .join("/");
}

export function buildSessionPartUploadPathname(sessionId: string, partType: string, fileName: string) {
  return joinStoragePath(
    "session-audio",
    "uploads",
    sessionId,
    String(partType).toLowerCase(),
    `${Date.now()}-${sanitizeStorageFileName(fileName)}`,
  );
}

export function buildTeacherRecordingUploadPathname(recordingId: string, fileName: string) {
  return joinStoragePath(
    "teacher-recordings",
    "uploads",
    recordingId,
    `${Date.now()}-${sanitizeStorageFileName(fileName)}`
  );
}

export function parseSessionPartUploadPathname(pathname: string): {
  sessionId: string;
  partType: SessionPartUploadPartType;
  fileName: string;
} | null {
  const normalized = String(pathname || "").trim().replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length < 5) return null;
  const prefix = parts.slice(0, 2).join("/");
  if (prefix !== SESSION_PART_UPLOAD_PATH_PREFIX) return null;

  const partType = parts[3]?.toUpperCase() as SessionPartUploadPartType;
  if (!SESSION_PART_UPLOAD_PART_TYPES.includes(partType)) return null;

  return {
    sessionId: parts[2] ?? "",
    partType,
    fileName: parts.slice(4).join("/"),
  };
}

export function extractBlobPathnameFromUrl(blobUrl: string) {
  const trimmed = String(blobUrl || "").trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed).pathname.replace(/^\/+/, "");
  } catch {
    return trimmed.replace(/^\/+/, "");
  }
}

export function buildLiveChunkPathname(
  sessionId: string,
  partType: string,
  sequence: number,
  fileName: string
) {
  return joinStoragePath(
    "session-audio",
    "live",
    sessionId,
    String(partType).toLowerCase(),
    `${String(sequence).padStart(5, "0")}-${sanitizeStorageFileName(fileName)}`,
  );
}

export function buildLiveManifestPathname(sessionId: string, partType: string) {
  return joinStoragePath("session-audio", "live", sessionId, String(partType).toLowerCase(), "manifest.json");
}
