import { normalizeAudioMimeType } from "@/lib/audio-upload-support";
import { upload } from "@vercel/blob/client";
import { parseSessionPartUploadPathname } from "@/lib/audio-storage-paths";
import { buildBlobUploadClientPayload } from "@/lib/blob-upload-client-payload";

type BrowserBlobUploadResult = {
  url: string;
  downloadUrl: string;
  pathname: string;
  contentType: string;
  contentDisposition: string;
  etag: string;
};

export async function uploadFileToBlobFromBrowser(input: {
  pathname: string;
  file: File;
  access?: "public" | "private";
  handleUploadUrl: string;
  uploadSource?: "file_upload" | "direct_recording";
}) {
  const normalizedContentType = normalizeAudioMimeType(input.file.type) || "application/octet-stream";
  const parsedPath = parseSessionPartUploadPathname(input.pathname);
  const clientPayload = parsedPath
    ? buildBlobUploadClientPayload({
        sessionId: parsedPath.sessionId,
        partType: parsedPath.partType,
        uploadedFileName: input.file.name,
        uploadedMimeType: normalizedContentType,
        uploadedByteSize: input.file.size,
        uploadSource: input.uploadSource ?? "file_upload",
      })
    : null;
  const blob = await upload(input.pathname, input.file, {
    access: input.access ?? "private",
    handleUploadUrl: input.handleUploadUrl,
    clientPayload: clientPayload ?? undefined,
    contentType: normalizedContentType,
    multipart: input.file.size > 8 * 1024 * 1024,
  });
  return blob as BrowserBlobUploadResult;
}
