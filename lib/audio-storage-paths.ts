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
