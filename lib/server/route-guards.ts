const MAINTENANCE_ROUTE_PREFIXES = ["/api/jobs/", "/api/maintenance/"] as const;

export function isMaintenanceRoutePath(pathname: string) {
  return MAINTENANCE_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function readBearerToken(authorizationHeader: string | null | undefined) {
  const value = authorizationHeader?.trim() ?? "";
  if (!value) return null;

  const [scheme, ...rest] = value.split(/\s+/);
  if (scheme.toLowerCase() !== "bearer") return null;

  const token = rest.join(" ").trim();
  return token || null;
}
