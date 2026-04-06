const SUPPORTED_AUDIO_UPLOAD_EXTENSIONS = [
  "mp3",
  "m4a",
] as const;

const SUPPORTED_AUDIO_UPLOAD_MIME_PATTERNS = [
  /^audio\/mpeg$/i,
  /^audio\/mp3$/i,
  /^audio\/mp4$/i,
  /^audio\/x-m4a$/i,
] as const;

const SUPPORTED_RECORDED_AUDIO_MIME_PATTERNS = [
  /^audio\/webm(?:;|$)/i,
  /^audio\/ogg(?:;|$)/i,
  /^audio\/mp4(?:;|$)/i,
] as const;

export type SupportedAudioUploadExtension = (typeof SUPPORTED_AUDIO_UPLOAD_EXTENSIONS)[number];

export { SUPPORTED_AUDIO_UPLOAD_EXTENSIONS };

export const AUDIO_UPLOAD_ACCEPT_ATTR = SUPPORTED_AUDIO_UPLOAD_EXTENSIONS.map((ext) => `.${ext}`).join(",");
export const AUDIO_UPLOAD_EXTENSIONS_LABEL = SUPPORTED_AUDIO_UPLOAD_EXTENSIONS.map((ext) => `.${ext}`).join(", ");

function normalizeFileExtension(fileName?: string | null) {
  const name = String(fileName || "").trim().toLowerCase();
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === name.length - 1) return "";
  return name.slice(dotIndex + 1);
}

export function getAudioUploadExtension(fileName?: string | null): SupportedAudioUploadExtension | null {
  const ext = normalizeFileExtension(fileName);
  if (!ext) return null;
  return SUPPORTED_AUDIO_UPLOAD_EXTENSIONS.includes(ext as SupportedAudioUploadExtension)
    ? (ext as SupportedAudioUploadExtension)
    : null;
}

export function isSupportedAudioUpload(input: { fileName?: string | null; mimeType?: string | null }) {
  const ext = getAudioUploadExtension(input.fileName);
  if (!ext) return false;

  const mimeType = String(input.mimeType || "").trim().toLowerCase();
  if (!mimeType) return true;
  return SUPPORTED_AUDIO_UPLOAD_MIME_PATTERNS.some((pattern) => pattern.test(mimeType));
}

export function isSupportedRecordedAudio(input: { fileName?: string | null; mimeType?: string | null }) {
  const mimeType = String(input.mimeType || "").trim().toLowerCase();
  if (mimeType) {
    return SUPPORTED_RECORDED_AUDIO_MIME_PATTERNS.some((pattern) => pattern.test(mimeType));
  }

  const fileName = String(input.fileName || "").trim().toLowerCase();
  return fileName.endsWith(".webm") || fileName.endsWith(".ogg") || fileName.endsWith(".mp4") || fileName.endsWith(".m4a");
}

export function buildUnsupportedAudioUploadErrorMessage() {
  return `対応拡張子は ${AUDIO_UPLOAD_EXTENSIONS_LABEL} です。対応していない形式はアップロードできません。`;
}

export function guessAudioMimeTypeFromFileName(fileName: string, fallback = "audio/webm") {
  switch (getAudioUploadExtension(fileName)) {
    case "mp3":
      return "audio/mpeg";
    case "m4a":
      return "audio/mp4";
    default:
      return fallback;
  }
}
