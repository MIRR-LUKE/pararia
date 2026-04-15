export type RumRouteStartSource = "initial-load" | "pushState" | "replaceState" | "popstate" | "fallback";

export type RumWindowState = {
  routeStartAt: number | null;
  routeStartSource: RumRouteStartSource;
  sentKeys: Set<string>;
  sampleRoll: number;
};

export type WebVitalRumEvent = {
  kind: "web-vital";
  name: string;
  id: string;
  value: number;
  delta: number | null;
  rating: string | null;
  routeKey: string;
  pathname: string;
  search: string;
  navigationType: string | null;
  sentAt: string;
};

export type RouteTimingRumEvent = {
  kind: "route-timing";
  routeKey: string;
  pathname: string;
  search: string;
  durationMs: number;
  transitionSource: RumRouteStartSource;
  navigationType: string;
  sentAt: string;
};

export type RumEvent = WebVitalRumEvent | RouteTimingRumEvent;

export type RumServerConfig = {
  endpointPath: string;
  enabled: boolean;
  bootedAt: string;
};

declare global {
  interface Window {
    __parariaRum?: RumWindowState;
  }

  var __parariaRumServerConfig: RumServerConfig | undefined;
}

export const RUM_ENDPOINT_PATH = "/api/rum";

export function isRumEnabled() {
  if (typeof window === "undefined") return false;
  return process.env.NEXT_PUBLIC_PARARIA_RUM_ENABLED === "1" || process.env.NEXT_PUBLIC_PARARIA_RUM_DEBUG === "1";
}

function normalizeSampleRate(value: string | undefined) {
  if (!value) return 1;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  if (parsed <= 0) return 0;
  if (parsed >= 1) return 1;
  return parsed;
}

export function getRumSampleRate() {
  return normalizeSampleRate(process.env.NEXT_PUBLIC_PARARIA_RUM_SAMPLE_RATE);
}

export function initializeRumServerConfig() {
  globalThis.__parariaRumServerConfig = {
    endpointPath: RUM_ENDPOINT_PATH,
    enabled: process.env.PARARIA_RUM_ENABLED === "1",
    bootedAt: new Date().toISOString(),
  };
}

export function getRumServerConfig() {
  return globalThis.__parariaRumServerConfig ?? {
    endpointPath: RUM_ENDPOINT_PATH,
    enabled: process.env.PARARIA_RUM_ENABLED === "1",
    bootedAt: new Date().toISOString(),
  };
}

export function ensureRumWindowState() {
  if (typeof window === "undefined") {
    throw new Error("Rum window state is only available in the browser.");
  }

  window.__parariaRum ??= {
    routeStartAt: 0,
    routeStartSource: "initial-load",
    sentKeys: new Set<string>(),
    sampleRoll: Math.random(),
  };

  return window.__parariaRum;
}

export function markRumRouteStart(source: RumRouteStartSource) {
  if (typeof window === "undefined") return;
  const state = ensureRumWindowState();
  state.routeStartAt = performance.now();
  state.routeStartSource = source;
}

export function buildRumRouteKey(pathname: string, search = "") {
  return search ? `${pathname}?${search}` : pathname;
}

function normalizeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function normalizeNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeEvent(event: RumEvent) {
  if (event.kind === "web-vital") {
    return {
      kind: event.kind,
      name: event.name,
      id: event.id,
      value: event.value,
      delta: event.delta,
      rating: event.rating,
      routeKey: event.routeKey,
      pathname: event.pathname,
      search: event.search,
      navigationType: event.navigationType,
      sentAt: event.sentAt,
    };
  }

  return {
    kind: event.kind,
    routeKey: event.routeKey,
    pathname: event.pathname,
    search: event.search,
    durationMs: event.durationMs,
    transitionSource: event.transitionSource,
    navigationType: event.navigationType,
    sentAt: event.sentAt,
  };
}

function shouldSendRumEvent() {
  if (!isRumEnabled()) return false;

  const sampleRate = getRumSampleRate();
  if (sampleRate >= 1) return true;
  if (sampleRate <= 0) return false;

  const state = ensureRumWindowState();
  return state.sampleRoll < sampleRate;
}

export function isRumEvent(value: unknown): value is RumEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  const kind = event.kind;

  if (kind === "web-vital") {
    return Boolean(
      normalizeNonEmptyString(event.name) &&
        normalizeNonEmptyString(event.id) &&
        normalizeNumber(event.value) !== null &&
        normalizeNonEmptyString(event.routeKey) &&
        normalizeNonEmptyString(event.pathname) &&
        normalizeString(event.search) !== null &&
        normalizeNonEmptyString(event.sentAt)
    );
  }

  if (kind === "route-timing") {
    return Boolean(
      normalizeNonEmptyString(event.routeKey) &&
        normalizeNonEmptyString(event.pathname) &&
        normalizeString(event.search) !== null &&
        normalizeNumber(event.durationMs) !== null &&
        normalizeNonEmptyString(event.transitionSource) &&
        normalizeNonEmptyString(event.navigationType) &&
        normalizeNonEmptyString(event.sentAt)
    );
  }

  return false;
}

export function dispatchRumEvent(event: RumEvent) {
  if (!shouldSendRumEvent()) return false;

  const body = JSON.stringify(normalizeEvent(event));
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const sent = navigator.sendBeacon(RUM_ENDPOINT_PATH, new Blob([body], { type: "application/json" }));
    if (sent) return true;
  }

  void fetch(RUM_ENDPOINT_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body,
    keepalive: true,
  }).catch(() => {});

  return false;
}
