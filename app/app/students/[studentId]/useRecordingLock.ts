"use client";

import { useCallback, useEffect, useRef } from "react";
import { RECORDING_LOCK_HEARTBEAT_MS } from "@/lib/recording/lockConstants";
import type { RecordingLockInfo } from "./roomTypes";
import type { SessionConsoleMode } from "./studentSessionConsoleTypes";

type Params = {
  studentId: string;
  mode: SessionConsoleMode;
  recordingLock?: RecordingLockInfo;
  isActive: boolean;
};

export function useRecordingLock({ studentId, mode, recordingLock, isActive }: Params) {
  const lockTokenRef = useRef<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const sendLockHeartbeat = useCallback(
    async (token: string) => {
      const response = await fetch(`/api/students/${studentId}/recording-lock`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lockToken: token }),
      }).catch(() => null);
      if (!response?.ok) return false;
      const body = await response.json().catch(() => ({}));
      return body?.ok === true;
    },
    [studentId]
  );

  const startHeartbeat = useCallback(
    (token: string) => {
      stopHeartbeat();
      heartbeatRef.current = setInterval(() => {
        void sendLockHeartbeat(token);
      }, RECORDING_LOCK_HEARTBEAT_MS);
    },
    [sendLockHeartbeat, stopHeartbeat]
  );

  const releaseLockClient = useCallback(
    async (token: string) => {
      await fetch(`/api/students/${studentId}/recording-lock`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lockToken: token }),
      }).catch(() => {});
    },
    [studentId]
  );

  const acquireLock = useCallback(async () => {
    const res = await fetch(`/api/students/${studentId}/recording-lock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body?.error ?? "録音ロックの取得に失敗しました。");
    }
    const token = body.lockToken as string;
    lockTokenRef.current = token;
    startHeartbeat(token);
    return token;
  }, [mode, startHeartbeat, studentId]);

  const ensureLockForAudio = useCallback(async () => {
    const token = lockTokenRef.current;
    if (token) {
      const isAlive = await sendLockHeartbeat(token);
      if (isAlive) {
        if (!heartbeatRef.current) {
          startHeartbeat(token);
        }
        return token;
      }
      stopHeartbeat();
      lockTokenRef.current = null;
    }
    return acquireLock();
  }, [acquireLock, sendLockHeartbeat, startHeartbeat, stopHeartbeat]);

  const finalizeLock = useCallback(async () => {
    stopHeartbeat();
    const token = lockTokenRef.current;
    lockTokenRef.current = null;
    if (token) {
      await releaseLockClient(token);
    }
  }, [releaseLockClient, stopHeartbeat]);

  useEffect(() => {
    if (isActive) {
      return undefined;
    }
    stopHeartbeat();
    return undefined;
  }, [isActive, stopHeartbeat]);

  useEffect(() => {
    if (!isActive) return undefined;

    const refreshHeartbeat = () => {
      void (async () => {
        const token = lockTokenRef.current;
        if (!token) {
          await acquireLock().catch(() => {});
          return;
        }
        const isAlive = await sendLockHeartbeat(token);
        if (isAlive) {
          if (!heartbeatRef.current) {
            startHeartbeat(token);
          }
          return;
        }
        stopHeartbeat();
        lockTokenRef.current = null;
        await acquireLock().catch(() => {});
      })();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshHeartbeat();
      }
    };

    window.addEventListener("focus", refreshHeartbeat);
    window.addEventListener("pageshow", refreshHeartbeat);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", refreshHeartbeat);
      window.removeEventListener("pageshow", refreshHeartbeat);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [acquireLock, isActive, sendLockHeartbeat, startHeartbeat, stopHeartbeat]);

  const lockConflict =
    recordingLock?.active &&
    recordingLock.lock &&
    !recordingLock.lock.isHeldByViewer;

  const lockConflictName = recordingLock?.lock?.lockedByName ?? "他のユーザー";

  return {
    acquireLock,
    ensureLockForAudio,
    finalizeLock,
    lockConflict,
    lockConflictName,
    lockTokenRef,
    releaseLockClient,
    startHeartbeat,
    stopHeartbeat,
  };
}
