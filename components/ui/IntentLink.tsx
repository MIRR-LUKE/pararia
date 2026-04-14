"use client";

import type { ComponentProps, FocusEvent, MouseEvent, TouchEvent } from "react";
import { useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type PrefetchMode = "intent" | "mount";

type Props = Omit<ComponentProps<typeof Link>, "href" | "prefetch"> & {
  href: string;
  prefetchMode?: PrefetchMode;
};

function scheduleIdle(callback: () => void) {
  if (typeof window === "undefined") return () => {};

  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(() => callback(), { timeout: 1200 });
    return () => window.cancelIdleCallback(id);
  }

  const timer = globalThis.setTimeout(callback, 250);
  return () => globalThis.clearTimeout(timer);
}

export function IntentLink({
  href,
  prefetchMode = "intent",
  onMouseEnter,
  onFocus,
  onTouchStart,
  ...props
}: Props) {
  const router = useRouter();
  const prefetchedRef = useRef(false);

  const prefetch = useCallback(() => {
    if (prefetchedRef.current) return;
    prefetchedRef.current = true;
    router.prefetch(href);
  }, [href, router]);

  useEffect(() => {
    if (prefetchMode !== "mount") return undefined;
    return scheduleIdle(prefetch);
  }, [prefetch, prefetchMode]);

  const handleMouseEnter = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      prefetch();
      onMouseEnter?.(event);
    },
    [onMouseEnter, prefetch]
  );

  const handleFocus = useCallback(
    (event: FocusEvent<HTMLAnchorElement>) => {
      prefetch();
      onFocus?.(event);
    },
    [onFocus, prefetch]
  );

  const handleTouchStart = useCallback(
    (event: TouchEvent<HTMLAnchorElement>) => {
      prefetch();
      onTouchStart?.(event);
    },
    [onTouchStart, prefetch]
  );

  return (
    <Link
      {...props}
      href={href}
      prefetch={false}
      onMouseEnter={handleMouseEnter}
      onFocus={handleFocus}
      onTouchStart={handleTouchStart}
    />
  );
}
