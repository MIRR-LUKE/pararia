"use client";

import { useEffect } from "react";
import type { PendingRecordingDraft } from "./studentSessionConsoleTypes";

type Params = {
  enabled: boolean;
  pendingDraft: PendingRecordingDraft | null;
};

export function useRecordingNavigationGuards({ enabled, pendingDraft }: Params) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || typeof document === "undefined" || typeof window === "undefined") return undefined;

    const handleAnchorNavigation = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      const nextUrl = new URL(anchor.href, window.location.href);
      const currentUrl = new URL(window.location.href);
      const isSameLocation =
        nextUrl.origin === currentUrl.origin &&
        nextUrl.pathname === currentUrl.pathname &&
        nextUrl.search === currentUrl.search &&
        nextUrl.hash === currentUrl.hash;
      if (isSameLocation) return;

      event.preventDefault();
      event.stopPropagation();
      const confirmed = window.confirm(
        pendingDraft
          ? "未送信の録音データがあります。移動すると再送前の確認を忘れやすくなります。移動しますか？"
          : "録音中または保存前の音声があります。移動すると録音が失われることがあります。移動しますか？"
      );
      if (confirmed) {
        window.location.href = nextUrl.toString();
      }
    };

    document.addEventListener("click", handleAnchorNavigation, true);
    return () => document.removeEventListener("click", handleAnchorNavigation, true);
  }, [enabled, pendingDraft]);
}
