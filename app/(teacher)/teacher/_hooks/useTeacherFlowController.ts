"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildTeacherRecordingFileName,
  loadTeacherPendingUploadStoreModule,
  pickRecordingMimeType,
  readAudioDurationSeconds,
  stopTracks,
  TEACHER_MIN_RECORDING_SECONDS,
  toPendingTeacherUploadItem,
} from "@/lib/teacher-app/recording-utils";
import type { TeacherAppBootstrap, TeacherFlowState, TeacherRecordingSummary } from "@/lib/teacher-app/types";

type Params = {
  bootstrap: TeacherAppBootstrap;
};

type StopIntent = "save" | "cancel";

type RecordingSupportTone = "ready" | "warning" | "danger";

type RecordingSupportState = {
  canStart: boolean;
  description: string | null;
  statusLabel: string;
  title: string | null;
  tone: RecordingSupportTone;
  type: "ready" | "permission_prompt" | "permission_denied" | "microphone_missing" | "unsupported" | "insecure";
};

type MemoryPendingTeacherUpload = {
  id: string;
  recordingId: string | null;
  file: File;
  durationSeconds: number | null;
  recordedAt: string;
  errorMessage: string | null;
  status: "pending" | "failed";
};

type TeacherConfirmResponse = {
  error?: string;
  result?: {
    state: "promoted" | "saved_without_student";
    sessionId: string | null;
    conversationId: string | null;
    alreadyConfirmed: boolean;
  };
};

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function sortMemoryPendingUploads(items: MemoryPendingTeacherUpload[]) {
  return [...items].sort((left, right) => right.recordedAt.localeCompare(left.recordedAt));
}

function createRecordingSupportState(
  input: RecordingSupportState["type"]
): RecordingSupportState {
  switch (input) {
    case "permission_prompt":
      return {
        type: input,
        canStart: true,
        statusLabel: "マイク許可を確認",
        tone: "warning",
        title: "最初にマイクの許可が表示される場合があります",
        description: "録音開始を押したあとに、端末の表示でマイクを許可してください。",
      };
    case "permission_denied":
      return {
        type: input,
        canStart: false,
        statusLabel: "マイク未許可",
        tone: "danger",
        title: "マイクの利用が許可されていません",
        description: "Safari または Chrome の設定でマイクを許可すると、この端末で録音できます。",
      };
    case "microphone_missing":
      return {
        type: input,
        canStart: false,
        statusLabel: "マイク未接続",
        tone: "danger",
        title: "この端末でマイクが見つかりません",
        description: "外部マイクを接続するか、マイク付きの端末に切り替えてください。",
      };
    case "unsupported":
      return {
        type: input,
        canStart: false,
        statusLabel: "録音非対応",
        tone: "danger",
        title: "この端末では録音できません",
        description: "最新の Safari または Chrome が使える端末で開き直してください。",
      };
    case "insecure":
      return {
        type: input,
        canStart: false,
        statusLabel: "HTTPS が必要です",
        tone: "danger",
        title: "安全な接続で開いてください",
        description: "録音は HTTPS または localhost の環境でのみ利用できます。",
      };
    case "ready":
    default:
      return {
        type: "ready",
        canStart: true,
        statusLabel: "マイク準備完了",
        tone: "ready",
        title: null,
        description: null,
      };
  }
}

async function detectRecordingSupport() {
  if (typeof window === "undefined") {
    return createRecordingSupportState("ready");
  }

  if (!window.isSecureContext) {
    return createRecordingSupportState("insecure");
  }

  if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return createRecordingSupportState("unsupported");
  }

  if (!pickRecordingMimeType()) {
    return createRecordingSupportState("unsupported");
  }

  let permissionGranted = false;

  if (navigator.permissions?.query) {
    try {
      const status = await navigator.permissions.query({
        name: "microphone" as PermissionName,
      });
      if (status.state === "denied") {
        return createRecordingSupportState("permission_denied");
      }
      if (status.state === "prompt") {
        return createRecordingSupportState("permission_prompt");
      }
      permissionGranted = status.state === "granted";
    } catch {
      // noop
    }
  }

  if (permissionGranted && navigator.mediaDevices.enumerateDevices) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!devices.some((device) => device.kind === "audioinput")) {
        return createRecordingSupportState("microphone_missing");
      }
    } catch {
      // noop
    }
  }

  return createRecordingSupportState("ready");
}

function getRecordingStartFailureState(error: unknown) {
  const name = typeof error === "object" && error && "name" in error ? String(error.name) : null;

  if (name === "NotAllowedError" || name === "SecurityError") {
    return {
      message: "マイクの利用が許可されていません。端末の設定で許可してからもう一度お試しください。",
      support: createRecordingSupportState("permission_denied"),
    };
  }

  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return {
      message: "この端末でマイクが見つかりません。接続を確認してもう一度お試しください。",
      support: createRecordingSupportState("microphone_missing"),
    };
  }

  if (name === "NotSupportedError") {
    return {
      message: "この端末では録音できません。別の端末または最新ブラウザをお試しください。",
      support: createRecordingSupportState("unsupported"),
    };
  }

  if (name === "NotReadableError" || name === "TrackStartError") {
    return {
      message: "ほかのアプリがマイクを使っている可能性があります。マイクを閉じてからもう一度お試しください。",
      support: null,
    };
  }

  return {
    message: null,
    support: null,
  };
}

export function useTeacherFlowController({ bootstrap }: Params) {
  const [state, setState] = useState<TeacherFlowState>(bootstrap.initialState);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recordingSupport, setRecordingSupport] = useState<RecordingSupportState>(createRecordingSupportState("ready"));
  const [pendingItems, setPendingItems] = useState(
    bootstrap.initialState.kind === "pending" ? bootstrap.initialState.items : []
  );
  const [pendingBusyId, setPendingBusyId] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordingIdRef = useRef<string | null>(bootstrap.activeRecording?.id ?? null);
  const stopIntentRef = useRef<StopIntent>("save");
  const pollingRecordingIdRef = useRef<string | null>(null);
  const pendingItemsRef = useRef(pendingItems);
  const memoryPendingUploadsRef = useRef<Map<string, MemoryPendingTeacherUpload>>(new Map());

  useEffect(() => {
    pendingItemsRef.current = pendingItems;
  }, [pendingItems]);

  useEffect(() => {
    setState(bootstrap.initialState);
  }, [bootstrap.initialState]);

  const refreshRecordingSupport = useCallback(async () => {
    const nextState = await detectRecordingSupport();
    setRecordingSupport(nextState);
    return nextState;
  }, []);

  const syncPendingItems = useCallback((nextItems: typeof pendingItems) => {
    pendingItemsRef.current = nextItems;
    setPendingItems(nextItems);
    setState((current) => {
      if (current.kind === "pending") {
        return {
          kind: "pending",
          items: nextItems,
        };
      }
      if (current.kind === "standby") {
        return {
          kind: "standby",
          unsentCount: nextItems.length,
        };
      }
      return current;
    });
    return nextItems;
  }, []);

  const listPendingUploads = useCallback(async () => {
    try {
      const { listPendingTeacherUploads } = await loadTeacherPendingUploadStoreModule();
      const records = await listPendingTeacherUploads();
      return syncPendingItems(records.map(toPendingTeacherUploadItem));
    } catch {
      const memoryItems = sortMemoryPendingUploads([...memoryPendingUploadsRef.current.values()]).map((record) =>
        toPendingTeacherUploadItem({
          id: record.id,
          recordingId: record.recordingId,
          fileName: record.file.name,
          mimeType: record.file.type || "audio/webm",
          sizeBytes: record.file.size,
          durationSeconds: record.durationSeconds,
          recordedAt: record.recordedAt,
          updatedAt: record.recordedAt,
          errorMessage: record.errorMessage,
          status: record.status,
          blob: record.file,
        })
      );
      return syncPendingItems(memoryItems);
    }
  }, [syncPendingItems]);

  useEffect(() => {
    void listPendingUploads();
  }, [listPendingUploads]);

  useEffect(() => {
    void refreshRecordingSupport();

    const handleWindowFocus = () => {
      void refreshRecordingSupport();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshRecordingSupport();
      }
    };

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshRecordingSupport]);

  useEffect(() => {
    if (state.kind !== "recording") return undefined;
    const timer = window.setInterval(() => {
      setState((current) => {
        if (current.kind !== "recording") return current;
        return {
          kind: "recording",
          recordingId: current.recordingId,
          seconds: current.seconds + 1,
        };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [state.kind]);

  const returnToStandby = useCallback(() => {
    pollingRecordingIdRef.current = null;
    setState({
      kind: "standby",
      unsentCount: pendingItemsRef.current.length,
    });
  }, []);

  const openPending = useCallback(() => {
    void listPendingUploads().then((items) => {
      setState({
        kind: "pending",
        items,
      });
    });
  }, [listPendingUploads]);

  const showDone = useCallback((title: string, description: string) => {
    setState({
      kind: "done",
      title,
      description,
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

  const removePendingUpload = useCallback(
    async (id: string) => {
      try {
        const { removePendingTeacherUpload } = await loadTeacherPendingUploadStoreModule();
        await removePendingTeacherUpload(id);
      } catch {
        // noop
      }
      memoryPendingUploadsRef.current.delete(id);
      await listPendingUploads().catch(() => null);
    },
    [listPendingUploads]
  );

  const loadPendingUploadRecord = useCallback(async (id: string) => {
    try {
      const { loadPendingTeacherUpload } = await loadTeacherPendingUploadStoreModule();
      const record = await loadPendingTeacherUpload(id);
      if (record) {
        return {
          id: record.id,
          recordingId: record.recordingId,
          file: new File([record.blob], record.fileName, {
            type: record.mimeType || "audio/webm",
            lastModified: Date.parse(record.updatedAt) || Date.now(),
          }),
          durationSeconds: record.durationSeconds,
          recordedAt: record.recordedAt,
          errorMessage: record.errorMessage,
          status: record.status,
        } satisfies MemoryPendingTeacherUpload;
      }
    } catch {
      // noop
    }

    return memoryPendingUploadsRef.current.get(id) ?? null;
  }, []);

  const savePendingUpload = useCallback(
    async (input: {
      id: string;
      recordingId: string | null;
      file: File;
      durationSeconds: number | null;
      recordedAt: string;
      errorMessage: string | null;
    }) => {
      try {
        const { savePendingTeacherUpload } = await loadTeacherPendingUploadStoreModule();
        await savePendingTeacherUpload({
          id: input.id,
          recordingId: input.recordingId,
          file: input.file,
          durationSeconds: input.durationSeconds,
          recordedAt: input.recordedAt,
          errorMessage: input.errorMessage,
          status: "failed",
        });
        memoryPendingUploadsRef.current.delete(input.id);
      } catch {
        memoryPendingUploadsRef.current.set(input.id, {
          id: input.id,
          recordingId: input.recordingId,
          file: input.file,
          durationSeconds: input.durationSeconds,
          recordedAt: input.recordedAt,
          errorMessage: input.errorMessage,
          status: "failed",
        });
      }
      await listPendingUploads().catch(() => null);
    },
    [listPendingUploads]
  );

  const applyLoadedRecording = useCallback(
    async (recording: TeacherRecordingSummary, opts?: { pendingId?: string | null }) => {
      if (opts?.pendingId) {
        await removePendingUpload(opts.pendingId).catch(() => null);
      }

      if (recording.status === "AWAITING_STUDENT_CONFIRMATION") {
        setErrorMessage(null);
        setState({
          kind: "confirm",
          recording,
        });
        pollingRecordingIdRef.current = null;
        return recording;
      }

      if (recording.status === "TRANSCRIBING") {
        setErrorMessage(null);
        setState({
          kind: "analyzing",
          recordingId: recording.id,
          description: "文字起こしと生徒候補を確認しています。",
        });
        return recording;
      }

      if (recording.status === "STUDENT_CONFIRMED") {
        setErrorMessage(null);
        showDone("送信しました", "ログを作成しています。");
        pollingRecordingIdRef.current = null;
        return recording;
      }

      if (recording.status === "ERROR") {
        setErrorMessage(recording.errorMessage ?? "文字起こしに失敗しました。");
        returnToStandby();
        pollingRecordingIdRef.current = null;
        return null;
      }

      return null;
    },
    [removePendingUpload, returnToStandby, showDone]
  );

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
          const handled = await applyLoadedRecording(body.recording);
          if (handled) {
            return handled;
          }
        }

        await sleep(1500);
      }

      setErrorMessage("処理に時間がかかっています。少し待ってからもう一度確認してください。");
      pollingRecordingIdRef.current = null;
      return null;
    },
    [applyLoadedRecording]
  );

  const createRecordingSession = useCallback(async () => {
    const createResponse = await fetch("/api/teacher/recordings", {
      method: "POST",
    });
    const createBody = (await createResponse.json().catch(() => ({}))) as { error?: string; recordingId?: string };
    if (!createResponse.ok || !createBody.recordingId) {
      throw new Error(createBody.error ?? "録音の準備に失敗しました。");
    }
    return createBody.recordingId;
  }, []);

  const uploadRecordedFile = useCallback(
    async (
      recordingId: string,
      file: File,
      opts?: {
        pendingId?: string | null;
        durationSeconds?: number | null;
        recordedAt?: string;
      }
    ) => {
      setState({
        kind: "analyzing",
        recordingId,
        description: "音声を送信しています。",
      });

      const durationSeconds =
        typeof opts?.durationSeconds === "number" ? opts.durationSeconds : await readAudioDurationSeconds(file);
      if (
        durationSeconds !== null &&
        Number.isFinite(durationSeconds) &&
        durationSeconds < TEACHER_MIN_RECORDING_SECONDS
      ) {
        await fetch(`/api/teacher/recordings/${recordingId}/cancel`, {
          method: "POST",
        }).catch(() => null);
        if (opts?.pendingId) {
          await removePendingUpload(opts.pendingId).catch(() => null);
        }
        setErrorMessage("録音時間が短すぎました。もう一度やり直してください。");
        returnToStandby();
        return;
      }

      const formData = new FormData();
      formData.append("file", file);
      if (durationSeconds !== null && Number.isFinite(durationSeconds)) {
        formData.append("durationSecondsHint", String(durationSeconds));
      }

      try {
        const response = await fetch(`/api/teacher/recordings/${recordingId}/audio`, {
          method: "POST",
          headers: {
            "Idempotency-Key": recordingId,
          },
          body: formData,
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          recording?: TeacherRecordingSummary;
        };

        if (!response.ok) {
          if (response.status === 409 && body.error?.includes("進行中")) {
            const current = await loadRecording(recordingId).catch(() => null);
            if (current) {
              const handled = await applyLoadedRecording(current, { pendingId: opts?.pendingId ?? null });
              if (handled) return;
            }
          }
          throw new Error(body.error ?? "音声の保存に失敗しました。");
        }

        if (opts?.pendingId) {
          await removePendingUpload(opts.pendingId).catch(() => null);
        }

        setState({
          kind: "analyzing",
          recordingId,
          description: "文字起こしと生徒候補を確認しています。",
        });
        await pollRecordingProgress(recordingId);
      } catch (error: any) {
        await savePendingUpload({
          id: opts?.pendingId ?? recordingId,
          recordingId,
          file,
          durationSeconds,
          recordedAt: opts?.recordedAt ?? new Date().toISOString(),
          errorMessage: error?.message ?? "音声の保存に失敗しました。",
        });
        throw new Error("送信できませんでした。未送信一覧から再送できます。");
      }
    },
    [applyLoadedRecording, loadRecording, pollRecordingProgress, removePendingUpload, returnToStandby, savePendingUpload]
  );

  const startRecording = useCallback(async () => {
    try {
      setErrorMessage(null);
      const support = await refreshRecordingSupport();
      if (!support.canStart) {
        throw new Error(support.description ?? "この端末では録音を始められません。");
      }

      const recordingId = await createRecordingSession();
      recordingIdRef.current = recordingId;
      stopIntentRef.current = "save";
      chunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      setRecordingSupport(createRecordingSupportState("ready"));
      mediaStreamRef.current = stream;

      const preferredMimeType = pickRecordingMimeType();
      const recorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);
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

        void uploadRecordedFile(currentRecordingId, file, {
          pendingId: currentRecordingId,
          recordedAt: new Date().toISOString(),
        }).catch((error: any) => {
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
      const failure = getRecordingStartFailureState(error);
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
      if (failure.support) {
        setRecordingSupport(failure.support);
      }
      setErrorMessage(failure.message ?? error?.message ?? "録音を開始できませんでした。");
      returnToStandby();
    }
  }, [createRecordingSession, refreshRecordingSupport, returnToStandby, uploadRecordedFile]);

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
      const body = (await response.json().catch(() => ({}))) as TeacherConfirmResponse;
      if (!response.ok || !body.result) {
        setErrorMessage(body.error ?? "生徒確認の保存に失敗しました。");
        return;
      }

      recordingIdRef.current = null;
      setErrorMessage(null);

      if (body.result.state === "saved_without_student") {
        showDone("送信しました", "生徒未確定で保存しました。管理画面で確認できます。");
        return;
      }

      showDone("送信しました", "ログを作成しています。");
    },
    [showDone, state]
  );

  const retryPendingUpload = useCallback(
    async (id: string) => {
      setPendingBusyId(id);
      try {
        const pending = await loadPendingUploadRecord(id);
        if (!pending) {
          await listPendingUploads().catch(() => null);
          return;
        }
        if (!pending.recordingId) {
          throw new Error("録音セッションが見つかりません。録音し直してください。");
        }
        setErrorMessage(null);
        await uploadRecordedFile(pending.recordingId, pending.file, {
          pendingId: pending.id,
          durationSeconds: pending.durationSeconds,
          recordedAt: pending.recordedAt,
        });
      } catch (error: any) {
        setErrorMessage(error?.message ?? "未送信の再送に失敗しました。");
        void listPendingUploads();
      } finally {
        setPendingBusyId(null);
      }
    },
    [listPendingUploads, loadPendingUploadRecord, uploadRecordedFile]
  );

  const deletePendingUpload = useCallback(
    async (id: string) => {
      setPendingBusyId(id);
      try {
        const pending = await loadPendingUploadRecord(id);
        if (pending?.recordingId) {
          await fetch(`/api/teacher/recordings/${pending.recordingId}/cancel`, {
            method: "POST",
          }).catch(() => null);
        }
        await removePendingUpload(id);
      } finally {
        setPendingBusyId(null);
      }
    },
    [loadPendingUploadRecord, removePendingUpload]
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
    canStartRecording: recordingSupport.canStart,
    cancelRecording,
    confirmNoStudent: () => void confirmStudent(null),
    confirmStudent,
    deletePendingUpload,
    errorMessage,
    microphoneDescription: recordingSupport.description,
    microphoneStatusLabel: recordingSupport.statusLabel,
    microphoneTitle: recordingSupport.title,
    microphoneTone: recordingSupport.tone,
    logout,
    openPending,
    pendingBusyId,
    pendingItems,
    refreshRecordingSupport,
    retryPendingUpload,
    returnToStandby,
    startRecording,
    state,
    stopRecording,
    unsentCount: useMemo(() => pendingItems.length, [pendingItems.length]),
  };
}
