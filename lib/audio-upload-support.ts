const SUPPORTED_AUDIO_UPLOAD_EXTENSIONS = [
  "mp3",
  "m4a",
  "mp4",
  "wav",
  "webm",
  "weba",
  "ogg",
  "oga",
  "opus",
  "aac",
  "flac",
  "aif",
  "aiff",
  "caf",
  "wma",
  "mpga",
] as const;

const SUPPORTED_AUDIO_UPLOAD_MIME_PATTERNS = [
  /^audio\/mpeg$/i,
  /^audio\/mp3$/i,
  /^audio\/mpga$/i,
  /^audio\/mpeg3$/i,
  /^audio\/mp4$/i,
  /^audio\/x-m4a$/i,
  /^video\/mp4$/i,
  /^application\/mp4$/i,
  /^audio\/wav$/i,
  /^audio\/x-wav$/i,
  /^audio\/wave$/i,
  /^audio\/vnd\.wave$/i,
  /^audio\/webm$/i,
  /^audio\/ogg$/i,
  /^application\/ogg$/i,
  /^audio\/opus$/i,
  /^audio\/aac$/i,
  /^audio\/x-aac$/i,
  /^audio\/flac$/i,
  /^audio\/x-flac$/i,
  /^audio\/aiff$/i,
  /^audio\/x-aiff$/i,
  /^audio\/caf$/i,
  /^audio\/x-caf$/i,
  /^audio\/wma$/i,
  /^audio\/x-ms-wma$/i,
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
  if (getAudioUploadExtension(input.fileName)) {
    return true;
  }
  const mimeType = String(input.mimeType || "").trim().toLowerCase();
  if (!mimeType) return false;
  return SUPPORTED_AUDIO_UPLOAD_MIME_PATTERNS.some((pattern) => pattern.test(mimeType));
}

export function buildUnsupportedAudioUploadErrorMessage() {
  return `対応拡張子は ${AUDIO_UPLOAD_EXTENSIONS_LABEL} です。対応していない形式はアップロードできません。`;
}

export function guessAudioMimeTypeFromFileName(fileName: string, fallback = "audio/webm") {
  switch (getAudioUploadExtension(fileName)) {
    case "mp3":
    case "mpga":
      return "audio/mpeg";
    case "m4a":
    case "mp4":
      return "audio/mp4";
    case "wav":
      return "audio/wav";
    case "webm":
    case "weba":
      return "audio/webm";
    case "ogg":
    case "oga":
      return "audio/ogg";
    case "opus":
      return "audio/opus";
    case "aac":
      return "audio/aac";
    case "flac":
      return "audio/flac";
    case "aif":
    case "aiff":
      return "audio/aiff";
    case "caf":
      return "audio/x-caf";
    case "wma":
      return "audio/x-ms-wma";
    default:
      return fallback;
  }
}
