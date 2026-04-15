function trimTrailingSlash(value: string) {
  return value.replace(/\/$/, "");
}

export function resolvePublicAppBaseUrl(request: Request) {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    "";

  if (configured) {
    return trimTrailingSlash(configured);
  }

  const origin = new URL(request.url);
  if (origin.hostname === "localhost" || origin.hostname === "127.0.0.1") {
    return origin.origin;
  }

  throw new Error("公開 URL が未設定です。NEXT_PUBLIC_APP_URL か NEXTAUTH_URL を設定してください。");
}

export function buildInvitationAcceptUrl(baseUrl: string, token: string) {
  return new URL(`/invite/accept?token=${encodeURIComponent(token)}`, trimTrailingSlash(baseUrl)).toString();
}
