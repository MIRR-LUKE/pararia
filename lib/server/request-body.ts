import { RequestValidationError } from "@/lib/server/request-validation";

function formatTooLargeMessage(label?: string) {
  return label ? `${label} の本文が大きすぎます。` : "本文が大きすぎます。";
}

function formatJsonErrorMessage(label?: string) {
  return label ? `${label} の JSON を読めませんでした。` : "JSON を読めませんでした。";
}

export async function parseJsonWithByteLimit<T = unknown>(
  request: Request,
  maxBytes: number,
  label?: string
): Promise<T> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const parsedLength = Number(contentLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      throw new RequestValidationError(formatTooLargeMessage(label), 413);
    }
  }

  const bodyText = await request.text();
  const byteLength = new TextEncoder().encode(bodyText).byteLength;
  if (byteLength > maxBytes) {
    throw new RequestValidationError(formatTooLargeMessage(label), 413);
  }

  try {
    return (bodyText.trim() ? JSON.parse(bodyText) : {}) as T;
  } catch {
    throw new RequestValidationError(formatJsonErrorMessage(label));
  }
}
