"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildTeacherRecordingFileName,
  pickRecordingMimeType,
  readAudioDurationSeconds,
  stopTracks,
  TEACHER_MIN_RECORDING_SECONDS,
} from "@/lib/teacher-app/recording-utils";
import type { TeacherAppBootstrap, TeacherFlowState, TeacherRecordingSummary } from "@/lib/teacher-app/types";

type Params = {
  bootstrap: TeacherAppBootstrap;
};

type StopIntent = "save" | "cancel";

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function useTeacherFlowController({ bootstrap }: Params) {
  const [state, setState] = useState<TeacherFlowState>(bootstrap.initialState);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const secondsRef = useRef(0);
  const recordingIdRef = useRef<string | null>(bootstrap.activeRecording?.id ?? null);
  const stopIntentRef = useRef<StopIntent>("save");
  const pollingRecordingIdRef = useRef<string | null>(null);

  useEffect(() => {
    setState(bootstrap.initialState);
  }, [bootstrap.initialState]);

  useEffect(() => {
    if (state.kind !== "recording") return undefined;
    const timer = window.setInterval(() => {
      setState((current) => {
        if (current.kind !== "recording") return current;
        const nextSeconds = current.seconds + 1;
        secondsRef.current = nextSeconds;
        return {
          kind: "recording",
          recordingId: current.recordingId,
          seconds: nextSeconds,
        };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [state.kind]);

  const returnToStandby = useCallback(() => {
    pollingRecordingIdRef.current = null;
    setState({
      kind: "standby",
      unsentCount: 0,
    });
  }, []);

  const openPending = useCallback(() => {
    setState({
      kind: "pending",
      items: [],
    });
  }, []);

  const loadRecording = useCallback(async (recordingId: string) => {
    const response = await fetch(`/api/teacher/recordings/${recordingId}`, {
      cache: "no-store",
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string; recording?: TeacherRecordingSummary };
    if (!response.ok || !body.recording) {
      throw new Error(body.error ?? "録音状態の取得に失敗しました。");
    }
    return body.recording;
  }, []);

  const pollRecordingProgress = useCallback(
    async (recordingId: string) => {
      pollingRecordingIdRef.current = recordingId;
      const startedAt = Date.now();
      while (Date.now() - startedAt < 10 * 60 * 1000) {
        const response = await fetch(`/api/teacher/recordings/${recordingId}/progress`, {
          cache: "no-store",
        });
        const body = (await response.json().catch(() => ({}))) as { error?: string; recording?: TeacherRecordingSummary };
        if (response.ok && body.recording) {
          if (body.recording.status === "AWAITING_STUDENT_CONFIRMATION") {
            setErrorMessage(null);
            setState({
              kind: "confirm",
              recording: body.recording,
            });
            pollingRecordingIdRef.current = null;
            return body.recording;
          }

          if (body.recording.status === "ERROR") {
            setErrorMessage(body.recording.errorMessage ?? "文字起こしに失敗しました。");
            returnToStandby();
            pollingRecordingIdRef.current = null;
            return null;
          }
        }

        await sleep(1500);
      }

      setErrorMessage("処理に時間がかかっています。少し待ってからもう一度確認してください。");
      pollingRecordingIdRef.current = null;
      return null;
    },
    [returnToStandby]
  );

  const uploadRecordedFile = useCallback(
    async (recordingId: string, file: File) => {
      setState({
        kind: "analyzing",
        recordingId,
        description: "音声を送信しています。",
      });

      const durationSeconds = await readAudioDurationSeconds(file);
      if (
        durationSeconds !== null &&
        Number.isFinite(durationSeconds) &&
        durationSeconds < TEACHER_MIN_RECORDING_SECONDS
      ) {
        await fetch(`/api/teacher/recordings/${recordingId}/cancel`, {
          method: "POST",
        }).catch(() => null);
        setErrorMessage("録音時間が短すぎました。もう一度やり直してください。");
        returnToStandby();
        return;
      }

      const formData = new FormData();
      formData.append("file", file);
      if (durationSeconds !== null && Number.isFinite(durationSeconds)) {
        formData.append("durationSecondsHint", String(durationSeconds));
      }

      const response = await fetch(`/api/teacher/recordings/${recordingId}/audio`, {
        method: "POST",
        body: formData,
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; recording?: TeacherRecordingSummary };
      if (!response.ok) {
        throw new Error(body.error ?? "音声の保存に失敗しました。");
      }

      setState({
        kind: "analyzing",
        recordingId,
        description: "文字起こしと生徒候補を確認しています。",
      });
      await pollRecordingProgress(recordingId);
    },
    [pollRecordingProgress, returnToStandby]
  );

  const startRecording = useCallback(async () => {
    try {
      setErrorMessage(null);
      if (typeof window === "undefined") return;
      if (!window.isSecureContext) {
        throw new Error("録音は HTTPS または localhost の環境でのみ利用できます。");
      }
      if (typeof MediaRecorder === "undefined") {
        throw new Error("この端末は録音に対応していません。");
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("マイク入力に対応していません。");
      }

      const createResponse = await fetch("/api/teacher/recordings", {
        method: "POST",
      });
      const createBody = (await createResponse.json().catch(() => ({}))) as { error?: string; recordingId?: string };
      if (!createResponse.ok || !createBody.recordingId) {
        throw new Error(createBody.error ?? "録音の準備に失敗しました。");
      }

      const recordingId = createBody.recordingId;
      recordingIdRef.current = recordingId;
      stopIntentRef.current = "save";
      chunksRef.current = [];
      secondsRef.current = 0;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      const preferredMimeType = pickRecordingMimeType();
      const recorder = preferredMimeType ? new MediaRecorder(stream, { mimeType: preferredMimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const currentRecordingId = recordingIdRef.current;
        const mimeType = recorder.mimeType || preferredMimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const file = new File([blob], buildTeacherRecordingFileName(currentRecordingId ?? "teacher", mimeType), {
          type: mimeType,
        });

        stopTracks(mediaStreamRef.current);
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        chunksRef.current = [];

        if (!currentRecordingId) {
          setErrorMessage("録音セッションが見つかりません。最初からやり直してください。");
          returnToStandby();
          return;
        }

        if (stopIntentRef.current === "cancel") {
          void fetch(`/api/teacher/recordings/${currentRecordingId}/cancel`, {
            method: "POST",
          }).catch(() => null);
          recordingIdRef.current = null;
          returnToStandby();
          return;
        }

        void uploadRecordedFile(currentRecordingId, file).catch((error: any) => {
          setErrorMessage(error?.message ?? "音声の保存に失敗しました。");
          returnToStandby();
        });
      };

      recorder.start(1000);
      setState({
        kind: "recording",
        recordingId,
        seconds: 0,
      });
    } catch (error: any) {
      const currentRecordingId = recordingIdRef.current;
      if (currentRecordingId) {
        void fetch(`/api/teacher/recordings/${currentRecordingId}/cancel`, {
          method: "POST",
        }).catch(() => null);
        recordingIdRef.current = null;
      }
      stopTracks(mediaStreamRef.current);
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;
      chunksRef.current = [];
      setErrorMessage(error?.message ?? "録音を開始できませんでした。");
      returnToStandby();
    }
  }, [returnToStandby, uploadRecordedFile]);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    stopIntentRef.current = "save";
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
  }, []);

  const cancelRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) {
      const currentRecordingId = recordingIdRef.current;
      if (currentRecordingId) {
        void fetch(`/api/teacher/recordings/${currentRecordingId}/cancel`, {
          method: "POST",
        }).catch(() => null);
      }
      returnToStandby();
      return;
    }
    stopIntentRef.current = "cancel";
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
  }, [returnToStandby]);

  const confirmStudent = useCallback(
    async (studentId: string | null) => {
      if (state.kind !== "confirm") return;
      const response = await fetch(`/api/teacher/recordings/${state.recording.id}/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          studentId,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setErrorMessage(body.error ?? "生徒確認の保存に失敗しました。");
        return;
      }
      recordingIdRef.current = null;
      setErrorMessage(null);
      setState({
        kind: "done",
      });
    },
    [state]
  );

  useEffect(() => {
    if (state.kind !== "analyzing") return undefined;
    if (pollingRecordingIdRef.current === state.recordingId) return undefined;
    void pollRecordingProgress(state.recordingId).catch((error: any) => {
      setErrorMessage(error?.message ?? "処理状態の確認に失敗しました。");
      returnToStandby();
    });
    return undefined;
  }, [pollRecordingProgress, returnToStandby, state]);

  const logout = useCallback(async () => {
    await fetch("/api/teacher/auth/logout", {
      method: "POST",
    }).catch(() => null);
    window.location.assign("/teacher/setup");
  }, []);

  const refreshActiveRecording = useCallback(async () => {
    if (!bootstrap.activeRecording?.id) return null;
    try {
      return await loadRecording(bootstrap.activeRecording.id);
    } catch {
      return null;
    }
  }, [bootstrap.activeRecording?.id, loadRecording]);

  useEffect(() => {
    if (!bootstrap.activeRecording?.id) return;
    void refreshActiveRecording().then((recording) => {
      if (!recording) return;
      if (recording.status === "AWAITING_STUDENT_CONFIRMATION") {
        setState({
          kind: "confirm",
          recording,
        });
      }
      if (recording.status === "TRANSCRIBING") {
        setState({
          kind: "analyzing",
          recordingId: recording.id,
          description: "文字起こしと生徒候補を確認しています。",
        });
      }
    });
  }, [bootstrap.activeRecording?.id, refreshActiveRecording]);

  return {
    cancelRecording,
    confirmNoStudent: () => void confirmStudent(null),
    confirmStudent,
    errorMessage,
    logout,
    openPending,
    returnToStandby,
    startRecording,
    state,
    stopRecording,
    unsentCount: useMemo(() => {
      if (state.kind === "standby") return state.unsentCount;
      return 0;
    }, [state]),
  };
}
