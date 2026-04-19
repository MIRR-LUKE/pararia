"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { TeacherAppBootstrap, TeacherFlowState, TeacherStudentCandidate } from "@/lib/teacher-app/types";

type Params = {
  bootstrap: TeacherAppBootstrap;
};

const PREVIEW_CANDIDATES: TeacherStudentCandidate[] = [
  { id: "preview-1", name: "山田 花子", subtitle: "中3 / 英語" },
  { id: "preview-2", name: "佐藤 翔", subtitle: "高2 / 数学" },
  { id: "preview-3", name: "鈴木 ひなた", subtitle: "中2 / 国語" },
];

export function useTeacherFlowController({ bootstrap }: Params) {
  const [state, setState] = useState<TeacherFlowState>(bootstrap.initialState);

  useEffect(() => {
    setState(bootstrap.initialState);
  }, [bootstrap.initialState]);

  const openPending = useCallback(() => {
    setState({
      kind: "pending",
      items: [],
    });
  }, []);

  const returnToStandby = useCallback(() => {
    setState({
      kind: "standby",
      unsentCount: 0,
    });
  }, []);

  const openRecordingPreview = useCallback(() => {
    setState({
      kind: "recording",
      seconds: 0,
    });
  }, []);

  const openDonePreview = useCallback(() => {
    setState({
      kind: "done",
    });
  }, []);

  const openConfirmPreview = useCallback(() => {
    setState({
      kind: "confirm",
      candidates: PREVIEW_CANDIDATES,
    });
  }, []);

  useEffect(() => {
    if (state.kind !== "recording") return undefined;
    const timer = window.setInterval(() => {
      setState((current) => {
        if (current.kind !== "recording") return current;
        return {
          kind: "recording",
          seconds: current.seconds + 1,
        };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [state.kind]);

  useEffect(() => {
    if (state.kind !== "analyzing") return undefined;
    const timer = window.setTimeout(() => {
      setState({
        kind: "confirm",
        candidates: PREVIEW_CANDIDATES,
      });
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [state.kind]);

  const logout = useCallback(async () => {
    await fetch("/api/teacher/auth/logout", {
      method: "POST",
    }).catch(() => null);
    window.location.assign("/teacher/setup");
  }, []);

  return {
    logout,
    openConfirmPreview,
    openDonePreview,
    openPending,
    openRecordingPreview,
    returnToStandby,
    state,
    unsentCount: useMemo(() => {
      if (state.kind === "standby") return state.unsentCount;
      return 0;
    }, [state]),
  };
}
