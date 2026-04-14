export type RouteParams<T extends Record<string, string | undefined> = { id: string }> = T | Promise<T>;

export function normalizeRouteParam(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

export async function resolveRouteParams<T extends Record<string, string | undefined>>(params: RouteParams<T>) {
  return Promise.resolve(params);
}

export async function resolveRouteId(params: RouteParams<{ id: string | undefined }>) {
  const resolved = await resolveRouteParams(params);
  return normalizeRouteParam(resolved.id);
}
