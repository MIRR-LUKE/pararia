#!/usr/bin/env tsx

import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvFile } from "./lib/load-env-file";
import { runScriptStep } from "./lib/script-step";
import {
  argValue,
  fileExists,
  waitForRunpodStop,
} from "./lib/recording-ui-runner";
import { assertMutatingFixtureEnvironment } from "./lib/environment-safety";
import { assertMeasurementStudent } from "./lib/measurement-student-guard";
import { getAudioDurationSeconds } from "../lib/audio-processing";

type NativeTeacherAuthResponse = {
  session: {
    organizationId: string;
    deviceId: string;
    deviceLabel: string;
  };
  auth: {
    accessToken: string;
    refreshToken: string;
    tokenType: string;
  };
};

type NativeTeacherRecordingSummary = {
  id: string;
  status: string;
  transcriptText: string | null;
  candidates: Array<{ id: string; name: string }>;
  errorMessage: string | null;
};

type NativeTeacherConfirmResponse = {
  ok: boolean;
  result?: {
    state: string;
    sessionId: string | null;
    conversationId: string | null;
    alreadyConfirmed: boolean;
  };
};

type NativeTeacherRecordingSmokeResult = {
  label: string;
  baseUrl: string;
  completionState: "success";
  recordingId: string;
  studentId: string;
  createdSessionId: string | null;
  createdConversationId: string | null;
  nextMeetingMemoStatus: string | null;
  runpodStoppedAfterStt: boolean;
  runpodStoppedAfterRun: boolean;
  observedStates: string[];
  candidateCount: number;
  transcriptPreview: string | null;
  simulatedRecordingMs: number;
  sttMs: number;
  confirmToConversationDoneMs: number;
  totalMs: number;
  consoleErrors: string[];
};

type CleanupContext = {
  envFile: string;
  deviceId: string | null;
  studentId: string | null;
  recordingId: string | null;
  accessToken: string | null;
  baseUrl: string;
};

async function parseJsonResponse<T>(response: Response) {
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body?.error || `request failed: ${response.status}`);
  }
  return body;
}

async function createMeasurementStudent(organizationId: string, label: string) {
  const [{ prisma }] = await Promise.all([import("../lib/db")]);
  const student = await prisma.student.create({
    data: {
      organizationId,
      name: `[${label}] Native Smoke Student`,
      grade: "検証用",
      course: "teacher-native-smoke",
    },
    select: {
      id: true,
      name: true,
      grade: true,
      course: true,
    },
  });
  return student;
}

async function waitForTeacherRecordingState(
  baseUrl: string,
  accessToken: string,
  recordingId: string,
  observedStates: Set<string>
) {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/teacher/recordings/${recordingId}/progress`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    });
    const body = await parseJsonResponse<{ recording?: NativeTeacherRecordingSummary }>(response);
    const summary = body.recording;
    if (!summary) {
      throw new Error("録音 progress の recording が空です。");
    }
    observedStates.add(summary.status);
    if (summary.status === "AWAITING_STUDENT_CONFIRMATION") {
      return summary;
    }
    if (summary.status === "ERROR") {
      throw new Error(summary.errorMessage || "teacher recording analysis failed");
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error("teacher recording が AWAITING_STUDENT_CONFIRMATION になるまでタイムアウトしました。");
}

async function waitForConversationDone(recordingId: string, fallbackSessionId: string | null) {
  const [{ prisma }] = await Promise.all([import("../lib/db")]);
  const deadline = Date.now() + 8 * 60_000;
  while (Date.now() < deadline) {
    const recording = await prisma.teacherRecordingSession.findUnique({
      where: { id: recordingId },
      select: {
        promotedSessionId: true,
        promotedConversationId: true,
      },
    });
    const sessionId = recording?.promotedSessionId ?? fallbackSessionId;
    if (sessionId) {
      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        select: {
          conversation: {
            select: {
              id: true,
              status: true,
              summaryMarkdown: true,
            },
          },
          nextMeetingMemo: {
            select: {
              status: true,
            },
          },
        },
      });
      const conversation = session?.conversation;
      if (conversation?.status === "DONE") {
        return {
          sessionId,
          conversationId: conversation.id,
          nextMeetingMemoStatus: session?.nextMeetingMemo?.status ?? null,
          summaryPreview: conversation.summaryMarkdown?.slice(0, 400) ?? null,
        };
      }
      if (conversation?.status === "ERROR") {
        throw new Error("promoted conversation ended in ERROR");
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2_500));
  }
  throw new Error("promoted conversation が DONE になるまでタイムアウトしました。");
}

async function cleanupArtifacts(context: CleanupContext) {
  const [{ prisma }, { deleteStorageEntry }] = await Promise.all([
    import("../lib/db"),
    import("../lib/audio-storage"),
  ]);

  try {
    if (context.accessToken) {
      await fetch(`${context.baseUrl}/api/teacher/native/auth/logout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${context.accessToken}`,
        },
      }).catch(() => {});
    }

    const deletedStorage = new Set<string>();
    const deleteStorageUrl = async (storageUrl: string | null | undefined) => {
      if (!storageUrl || deletedStorage.has(storageUrl)) return;
      deletedStorage.add(storageUrl);
      await deleteStorageEntry(storageUrl).catch(() => {});
    };

    if (context.recordingId) {
      const recording = await prisma.teacherRecordingSession.findUnique({
        where: { id: context.recordingId },
        select: {
          id: true,
          audioStorageUrl: true,
          promotedSessionId: true,
          promotedConversationId: true,
        },
      });
      await deleteStorageUrl(recording?.audioStorageUrl);

      if (recording?.promotedSessionId) {
        const session = await prisma.session.findUnique({
          where: { id: recording.promotedSessionId },
          include: {
            parts: true,
            conversation: true,
          },
        });
        for (const part of session?.parts ?? []) {
          await deleteStorageUrl(part.storageUrl);
        }
        if (session?.conversation) {
          await prisma.conversationJob.deleteMany({ where: { conversationId: session.conversation.id } }).catch(() => {});
          await prisma.conversationLog.deleteMany({ where: { id: session.conversation.id } }).catch(() => {});
        }
        await prisma.sessionPartJob.deleteMany({ where: { sessionPart: { sessionId: recording.promotedSessionId } } }).catch(() => {});
        await prisma.sessionPart.deleteMany({ where: { sessionId: recording.promotedSessionId } }).catch(() => {});
        await prisma.nextMeetingMemo.deleteMany({ where: { sessionId: recording.promotedSessionId } }).catch(() => {});
        await prisma.session.deleteMany({ where: { id: recording.promotedSessionId } }).catch(() => {});
      }

      await prisma.teacherRecordingJob.deleteMany({ where: { recordingSessionId: context.recordingId } }).catch(() => {});
      await prisma.teacherRecordingSession.deleteMany({ where: { id: context.recordingId } }).catch(() => {});
    }

    if (context.studentId) {
      const student = await prisma.student.findUnique({
        where: { id: context.studentId },
        select: { id: true, name: true, grade: true, course: true },
      });
      assertMeasurementStudent(student, {
        namePrefix: "[",
        allowedGrades: ["検証用"],
        coursePrefixes: ["teacher-native-smoke"],
      });
      await prisma.studentProfile.deleteMany({ where: { studentId: context.studentId } }).catch(() => {});
      await prisma.student.deleteMany({ where: { id: context.studentId } }).catch(() => {});
    }

    if (context.deviceId) {
      await prisma.teacherAppDeviceAuthSession.deleteMany({ where: { deviceId: context.deviceId } }).catch(() => {});
      await prisma.teacherAppDevice.deleteMany({ where: { id: context.deviceId } }).catch(() => {});
    }
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

async function main() {
  const label = argValue(process.argv, "--label") || process.env.TEACHER_RECORDING_SMOKE_LABEL || "local";
  const baseUrl =
    argValue(process.argv, "--base-url") || process.env.TEACHER_RECORDING_SMOKE_BASE_URL || "http://localhost:3000";
  const envFile = path.resolve(
    process.cwd(),
    argValue(process.argv, "--env-file") || process.env.TEACHER_RECORDING_SMOKE_ENV_FILE || ".env.local"
  );
  const uploadFilePath = path.resolve(
    process.cwd(),
    argValue(process.argv, "--upload-file-path") ||
      process.env.TEACHER_RECORDING_SMOKE_UPLOAD_FILE_PATH ||
      "scripts/fixtures/audio/prod-e2e-65s.mp3"
  );
  const outputPath = path.resolve(
    process.cwd(),
    argValue(process.argv, "--output") ||
      process.env.TEACHER_RECORDING_SMOKE_OUTPUT ||
      `.tmp/teacher-recording-smoke-${label}.json`
  );

  await loadEnvFile(envFile, { overrideExisting: true, optional: true });
  assertMutatingFixtureEnvironment(baseUrl, label);

  if (!(await fileExists(uploadFilePath))) {
    throw new Error(`指定された upload file が見つかりません: ${uploadFilePath}`);
  }

  const simulatedRecordingMs = Math.max(
    0,
    Number(
      argValue(process.argv, "--simulate-recording-ms") ||
        process.env.TEACHER_RECORDING_SMOKE_SIMULATED_RECORDING_MS ||
        Math.round((await getAudioDurationSeconds(uploadFilePath)) * 1000)
    ) || 0
  );

  const email = process.env.CRITICAL_PATH_SMOKE_EMAIL?.trim();
  const password = process.env.CRITICAL_PATH_SMOKE_PASSWORD?.trim();
  if (!email || !password) {
    throw new Error("CRITICAL_PATH_SMOKE_EMAIL / CRITICAL_PATH_SMOKE_PASSWORD が必要です。");
  }

  const cleanupContext: CleanupContext = {
    envFile,
    deviceId: null,
    studentId: null,
    recordingId: null,
    accessToken: null,
    baseUrl,
  };

  const result = await runScriptStep("teacher-recording-smoke", "run", async () => {
    const startedAt = Date.now();
    const observedStates = new Set<string>(["device_login"]);

    try {
      const labelPrefix = label.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 24) || "teacher-smoke";
      const deviceLabel = `teacher-smoke-${labelPrefix}-${randomUUID().slice(0, 8)}`.slice(0, 60);
      const loginResponse = await fetch(`${baseUrl}/api/teacher/native/auth/device-login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
          deviceLabel,
          client: {
            platform: "ANDROID",
            appVersion: "smoke",
            buildNumber: "1",
          },
        }),
      });
      const auth = await parseJsonResponse<NativeTeacherAuthResponse>(loginResponse);
      const accessToken = auth.auth.accessToken;
      cleanupContext.deviceId = auth.session.deviceId;
      cleanupContext.accessToken = accessToken;

      const student = await createMeasurementStudent(auth.session.organizationId, label);
      cleanupContext.studentId = student.id;

      const createRecordingResponse = await fetch(`${baseUrl}/api/teacher/recordings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const created = await parseJsonResponse<{ recordingId: string }>(createRecordingResponse);
      const recordingId = created.recordingId;
      cleanupContext.recordingId = recordingId;
      observedStates.add("recording_created");

      if (simulatedRecordingMs > 0) {
        observedStates.add("recording_prewarm");
        await new Promise((resolve) => setTimeout(resolve, simulatedRecordingMs));
      }

      const audioBuffer = await readFile(uploadFilePath);
      const formData = new FormData();
      formData.append(
        "file",
        new File([audioBuffer], path.basename(uploadFilePath), {
          type: "audio/mpeg",
        })
      );
      const uploadResponse = await fetch(`${baseUrl}/api/teacher/recordings/${recordingId}/audio`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Idempotency-Key": `${recordingId}-${randomUUID()}`,
        },
        body: formData,
      });
      await parseJsonResponse<{ recording?: NativeTeacherRecordingSummary }>(uploadResponse);
      observedStates.add("uploading");

      const sttStartedAt = Date.now();
      const awaiting = await waitForTeacherRecordingState(baseUrl, accessToken, recordingId, observedStates);
      const sttMs = Date.now() - sttStartedAt;
      observedStates.add("awaiting_student_confirmation");

      const runpodStoppedAfterStt = await waitForRunpodStop(envFile);
      observedStates.add(runpodStoppedAfterStt ? "runpod_stopped_after_stt" : "runpod_not_stopped_after_stt");

      const confirmStartedAt = Date.now();
      const confirmResponse = await fetch(`${baseUrl}/api/teacher/recordings/${recordingId}/confirm`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          studentId: student.id,
        }),
      });
      const confirmed = await parseJsonResponse<NativeTeacherConfirmResponse>(confirmResponse);
      observedStates.add("student_confirmed");

      const conversation = await waitForConversationDone(
        recordingId,
        confirmed.result?.sessionId ?? null
      );
      const confirmToConversationDoneMs = Date.now() - confirmStartedAt;
      observedStates.add("conversation_done");

      const runpodStoppedAfterRun = await waitForRunpodStop(envFile);

      const smokeResult: NativeTeacherRecordingSmokeResult = {
        label,
        baseUrl,
        completionState: "success",
        recordingId,
        studentId: student.id,
        createdSessionId: conversation.sessionId,
        createdConversationId: conversation.conversationId,
        nextMeetingMemoStatus: conversation.nextMeetingMemoStatus,
        runpodStoppedAfterStt,
        runpodStoppedAfterRun,
        observedStates: Array.from(observedStates),
        candidateCount: awaiting.candidates.length,
        transcriptPreview: awaiting.transcriptText?.slice(0, 400) ?? null,
        simulatedRecordingMs,
        sttMs,
        confirmToConversationDoneMs,
        totalMs: Date.now() - startedAt,
        consoleErrors: [],
      };

      await writeFile(outputPath, JSON.stringify(smokeResult, null, 2), "utf8");
      return smokeResult;
    } finally {
      await cleanupArtifacts(cleanupContext).catch(() => {});
    }
  });

  if (!result.runpodStoppedAfterStt) {
    throw new Error("teacher native smoke で STT 完了後に Runpod が stopped になりませんでした。");
  }
  if (!result.runpodStoppedAfterRun) {
    throw new Error("teacher native smoke 後に Runpod が stopped になりませんでした。");
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
