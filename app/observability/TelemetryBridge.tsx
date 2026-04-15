"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";
import {
  buildRumRouteKey,
  dispatchRumEvent,
  ensureRumWindowState,
  isRumEnabled,
  markRumRouteStart,
} from "@/lib/observability/rum";

function getNavigationType() {
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return navigation?.type ?? "navigate";
}

export function TelemetryBridge() {
  const rumEnabled = isRumEnabled();
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const search = searchParams ? searchParams.toString() : "";
  const routeKey = buildRumRouteKey(pathname, search);
  const lastRouteKeyRef = useRef(routeKey);

  useEffect(() => {
    lastRouteKeyRef.current = routeKey;
  }, [routeKey]);

  useEffect(() => {
    if (!rumEnabled) return;

    const state = ensureRumWindowState();
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);

    history.pushState = ((...args: Parameters<History["pushState"]>) => {
      markRumRouteStart("pushState");
      return originalPushState(...args);
    }) as History["pushState"];

    history.replaceState = ((...args: Parameters<History["replaceState"]>) => {
      markRumRouteStart("replaceState");
      return originalReplaceState(...args);
    }) as History["replaceState"];

    const onPopState = () => {
      markRumRouteStart("popstate");
    };

    window.addEventListener("popstate", onPopState);

    if (state.routeStartAt === null) {
      markRumRouteStart("initial-load");
    }

    return () => {
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
      window.removeEventListener("popstate", onPopState);
    };
  }, [rumEnabled]);

  useEffect(() => {
    if (!rumEnabled) return;

    const state = ensureRumWindowState();
    const routeStartAt = state.routeStartAt ?? 0;
    const transitionSource = state.routeStartSource;
    const sendKey = `route:${routeKey}:${Math.round(routeStartAt)}`;

    if (state.sentKeys.has(sendKey)) return;

    const timeout = window.setTimeout(() => {
      if (state.sentKeys.has(sendKey)) return;
      state.sentKeys.add(sendKey);
      dispatchRumEvent({
        kind: "route-timing",
        routeKey,
        pathname,
        search,
        durationMs: Math.max(0, Math.round(performance.now() - routeStartAt)),
        transitionSource,
        navigationType: transitionSource === "initial-load" ? getNavigationType() : transitionSource,
        sentAt: new Date().toISOString(),
      });
    }, 0);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [pathname, routeKey, rumEnabled, search]);

  useReportWebVitals((metric) => {
    if (!rumEnabled) return;

    const rumMetric = metric as {
      navigationType?: string;
      rating?: string | null;
      delta?: number | null;
    };
    const state = ensureRumWindowState();
    const sendKey = `vital:${metric.id}`;
    if (state.sentKeys.has(sendKey)) return;
    state.sentKeys.add(sendKey);

    dispatchRumEvent({
      kind: "web-vital",
      name: metric.name,
      id: metric.id,
      value: metric.value,
      delta: rumMetric.delta ?? null,
      rating: rumMetric.rating ?? null,
      routeKey: lastRouteKeyRef.current,
      pathname,
      search,
      navigationType: rumMetric.navigationType ?? null,
      sentAt: new Date().toISOString(),
    });
  });

  return null;
}
