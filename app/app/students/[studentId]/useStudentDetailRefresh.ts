"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomResponse } from "./roomTypes";

type Params = {
  initialRoom: RoomResponse;
  studentId: string;
};

type Result = {
  room: RoomResponse | null;
  loading: boolean;
  error: string | null;
  refresh: (opts?: { silent?: boolean }) => Promise<void>;
};

export function useStudentDetailRefresh({ initialRoom, studentId }: Params): Result {
  const [room, setRoom] = useState<RoomResponse | null>(initialRoom);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageVisible, setPageVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState === "visible"
  );
  const hasLoadedRoomRef = useRef(true);

  const refresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;
      const shouldBlock = !silent && !hasLoadedRoomRef.current;
      if (shouldBlock) {
        setLoading(true);
        setError(null);
      } else if (!silent) {
        setError(null);
      }
      try {
        const res = await fetch(`/api/students/${studentId}/room`, { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? "生徒ルームの取得に失敗しました。");
        setRoom(body);
        hasLoadedRoomRef.current = true;
      } catch (nextError: any) {
        if (shouldBlock) {
          setError(nextError?.message ?? "生徒ルームの取得に失敗しました。");
        }
      } finally {
        if (shouldBlock) {
          setLoading(false);
        }
      }
    },
    [studentId]
  );

  useEffect(() => {
    setRoom(initialRoom);
    setLoading(false);
    setError(null);
    hasLoadedRoomRef.current = true;
  }, [initialRoom]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const updateVisibility = () => setPageVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => {
    if (!room?.sessions?.length) return;
    const hasActivePipeline = room.sessions.some((session) =>
      ["TRANSCRIBING", "GENERATING"].includes(session.pipeline?.stage ?? "")
    );
    const hasPendingNextMeetingMemo = room.sessions.some((session) =>
      ["QUEUED", "GENERATING"].includes(session.nextMeetingMemo?.status ?? "")
    );
    if ((!hasActivePipeline && !hasPendingNextMeetingMemo) || !pageVisible) return;
    const timer = window.setTimeout(() => {
      void refresh({ silent: true });
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [pageVisible, refresh, room, room?.sessions]);

  useEffect(() => {
    if (!pageVisible || !room?.sessions?.length) return;
    const hasLiveWork = room.sessions.some((session) =>
      ["TRANSCRIBING", "GENERATING"].includes(session.pipeline?.stage ?? "") ||
      ["QUEUED", "GENERATING"].includes(session.nextMeetingMemo?.status ?? "")
    );
    if (!hasLiveWork) return;
    void refresh({ silent: true });
  }, [pageVisible, refresh, room, room?.sessions]);

  return { room, loading, error, refresh };
}
