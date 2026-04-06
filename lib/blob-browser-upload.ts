const DEFAULT_BLOB_API_URL = "https://vercel.com/api/blob";
const BLOB_API_VERSION = "12";

type BlobGenerateTokenResponse = {
  type: "blob.generate-client-token";
  clientToken: string;
};

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
}) {
  const tokenResponse = await fetch(input.handleUploadUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "blob.generate-client-token",
      payload: {
        pathname: input.pathname,
      },
    }),
  });

  const tokenBody = (await tokenResponse.json().catch(() => ({}))) as Partial<BlobGenerateTokenResponse> & {
    error?: string;
  };
  if (!tokenResponse.ok || typeof tokenBody.clientToken !== "string") {
    throw new Error(tokenBody.error ?? "blob client token generation failed");
  }

  const params = new URLSearchParams({ pathname: input.pathname });
  const blobApiUrl = process.env.NEXT_PUBLIC_VERCEL_BLOB_API_URL?.trim() || DEFAULT_BLOB_API_URL;
  const uploadResponse = await fetch(`${blobApiUrl}/?${params.toString()}`, {
    method: "PUT",
    body: input.file,
    headers: {
      authorization: `Bearer ${tokenBody.clientToken}`,
      "x-api-version": BLOB_API_VERSION,
      "x-content-length": String(input.file.size),
      "x-content-type": input.file.type || "application/octet-stream",
      "x-vercel-blob-access": input.access ?? "private",
    },
  });

  const uploadBody = (await uploadResponse.json().catch(() => ({}))) as Partial<BrowserBlobUploadResult> & {
    error?: {
      message?: string;
      code?: string;
    };
  };
  if (!uploadResponse.ok || typeof uploadBody.url !== "string") {
    throw new Error(uploadBody.error?.message ?? "blob upload failed");
  }

  return uploadBody as BrowserBlobUploadResult;
}
