#!/usr/bin/env tsx

import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { loadEnvFile } from "./lib/load-env-file";
import { loadLocalEnvFiles } from "./lib/load-local-env";
import { createAudioClip, must, parseArg, readBoolArg, readNumberArg } from "./lib/runpod-measure-ux-core";
import { GPU_PROFILES, type GpuProfileName, type StartupMode } from "./lib/runpod-measure-ux-runpod";
import {
  cleanupBenchmarkRecords,
  createBootstrapWorkerPod,
  createDirectWorkerPod,
  deleteRunpodPod,
  terminatePodsByName,
  waitForWorkerReady,
} from "./lib/runpod-measure-ux-worker";
import { patchRunpodPodWorkerConfig, startRunpodPod, stopRunpodPod } from "./lib/runpod-measure-ux-runpod";

type RunpodMeasureResult = {
  ok: boolean;
  profile: GpuProfileName;
  gpu: string;
  startupMode: StartupMode;
  workerImage?: string | null;
  workerName?: string | null;
  runpodWorkerImage?: string | null;
  runpodWorkerRuntimeRevision?: string | null;
  runpodWorkerGitSha?: string | null;
  runpodWorkerFeatureFlags?: Record<string, unknown> | null;
  interruptible: boolean;
  sourceAudioPath: string;
  clipAudioPath?: string;
  clipStartSeconds?: number;
  clipDurationSeconds?: number;
  audioDurationSeconds: number | null;
  createAttempts?: number;
  reusePreparedPodId?: string | null;
  reusePreparedAt?: string | null;
  podId?: string;
  podReadyAt?: string | null;
  podReadyMs?: number | null;
  enqueueStartedAt: string;
  sttCompletedAt?: string | null;
  conversationCompletedAt?: string | null;
  promotionCompletedAt?: string | null;
  conversationKickRequestedAt?: string | null;
  conversationKickDeferredAt?: string | null;
  conversationKickDeferredReason?: string | null;
  conversationAppDispatchStartedAt?: string | null;
  conversationAppDispatchBlockedAt?: string | null;
  conversationAppDispatchBlockedReason?: string | null;
  conversationAppDispatchCompletedAt?: string | null;
  conversationJobClaimedAt?: string | null;
  reviewStartedAt?: string | null;
  reviewCompletedAt?: string | null;
  finalizeStartedAt?: string | null;
  finalizeCompletedAt?: string | null;
  queueToSttMs?: number | null;
  queueToConversationMs?: number | null;
  postSttTotalMs?: number | null;
  sttToPromotionMs?: number | null;
  promotionToKickMs?: number | null;
  kickDeferredToKickMs?: number | null;
  kickToAppDispatchMs?: number | null;
  appDispatchToClaimMs?: number | null;
  claimToReviewStartMs?: number | null;
  reviewDurationMs?: number | null;
  reviewToFinalizeMs?: number | null;
  finalizeActiveMs?: number | null;
  postSttUnknownMs?: number | null;
  sttSeconds?: number | null;
  sttPrepareMs?: number | null;
  sttTranscribeMs?: number | null;
  sttTranscribeWorkerMs?: number | null;
  sttFinalizeMs?: number | null;
  sttVadParameters?: Record<string, number> | null;
  sttModel?: string | null;
  sttDevice?: string | null;
  sttComputeType?: string | null;
  sttPipeline?: string | null;
  sttBatchSize?: number | null;
  transcriptChars?: number | null;
  finalizeDurationMs?: number | null;
  finalizeQueueLagMs?: number | null;
  llmApiCalls?: number | null;
  llmInputTokens?: number | null;
  llmCachedInputTokens?: number | null;
  llmCachedInputRatio?: number | null;
  llmOutputTokens?: number | null;
  llmCostUsd?: number | null;
  promptCacheKey?: string | null;
  promptCacheRetention?: "in_memory" | "24h" | null;
  promptCacheStablePrefixChars?: number | null;
  promptCacheStablePrefixTokensEstimate?: number | null;
  finalizeModel?: string | null;
  artifactChars?: number | null;
  studentId?: string | null;
  studentName?: string | null;
  recordsKept?: boolean;
  sessionId?: string;
  partId?: string;
  conversationId?: string | null;
  error?: string;
};

function asObjectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readIsoString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function diffIsoMs(start: string | null | undefined, end: string | null | undefined) {
  if (!start || !end) return null;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return Math.max(0, endMs - startMs);
}

function sumNumbers(values: Array<number | null | undefined>) {
  let total = 0;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return null;
    }
    total += value;
  }
  return total;
}

function applyRunpodWorkerMetadata(result: RunpodMeasureResult, source: unknown) {
  const record = asObjectRecord(source);
  if (!record) return;

  const workerImage =
    typeof record.runpodWorkerImage === "string" && record.runpodWorkerImage.trim()
      ? record.runpodWorkerImage.trim()
      : null;
  if (workerImage) {
    result.runpodWorkerImage = workerImage;
    result.workerImage = result.workerImage || workerImage;
  }

  const runtimeRevision =
    typeof record.runpodWorkerRuntimeRevision === "string" && record.runpodWorkerRuntimeRevision.trim()
      ? record.runpodWorkerRuntimeRevision.trim()
      : null;
  if (runtimeRevision) {
    result.runpodWorkerRuntimeRevision = runtimeRevision;
  }

  const gitSha =
    typeof record.runpodWorkerGitSha === "string" && record.runpodWorkerGitSha.trim()
      ? record.runpodWorkerGitSha.trim()
      : null;
  if (gitSha) {
    result.runpodWorkerGitSha = gitSha;
  }

  const featureFlags = asObjectRecord(record.runpodWorkerFeatureFlags);
  if (featureFlags) {
    result.runpodWorkerFeatureFlags = featureFlags;
  }
}

const EXISTING_STUDENT_TARGET_OVERRIDE_ENV = "PARARIA_ALLOW_EXISTING_STUDENT_TARGET";

function assertExistingStudentTargetAllowed(targetStudentName: string) {
  if (!targetStudentName) return;
  if (targetStudentName.startsWith("[")) return;
  if (process.env[EXISTING_STUDENT_TARGET_OVERRIDE_ENV]?.trim() === "1") return;
  throw new Error(
    `既存の生徒 "${targetStudentName}" を直接使う計測は既定で止めています。` +
      `新規の検証用生徒を使ってください。` +
      `どうしても既存生徒を使うときだけ ${EXISTING_STUDENT_TARGET_OVERRIDE_ENV}=1 を指定してください。`
  );
}

async function main() {
  const profileName = (parseArg("profile", "3090") ?? "3090") as GpuProfileName;
  const profile = GPU_PROFILES[profileName];
  if (!profile) {
    throw new Error(`unsupported profile: ${profileName}`);
  }

  const sourceAudioPath = path.resolve(
    parseArg("source-audio", "C:/Users/lukew/Desktop/01-30 面談_ 受験戦略とルール運用（時間配分・見直し・難問後回し.mp3")!
  );
  const outputPath = path.resolve(parseArg("out", `.tmp/runpod-ux-${profileName}.json`)!);
  const clipStartSeconds = readNumberArg("clip-start", 30);
  const clipDurationSeconds = readNumberArg("clip-duration", 0);
  const timeoutMs = readNumberArg("timeout-ms", 45 * 60 * 1000);
  const pollMs = readNumberArg("poll-ms", 5000);
  const autoStopIdleMs = readNumberArg("auto-stop-idle-ms", 60 * 1000);
  const createRetries = readNumberArg("create-retries", 2);
  const createRetryWaitMs = readNumberArg("create-retry-wait-ms", 30000);
  const interruptible = readBoolArg("interruptible", false);
  const keepRecords = readBoolArg("keep-records", false);
  const startupMode = (parseArg("startup-mode", "direct") ?? "direct") as StartupMode;
  const gitRef = parseArg("git-ref", "main")!;
  const targetStudentName = (parseArg("student-name", "") ?? "").trim();
  const fallbackEnvFile = path.resolve(parseArg("fallback-env-file", ".tmp/.env.production.runpod")!);
  const outputDir = path.resolve(parseArg("out-dir", ".tmp/runpod-ux")!);
  let workerImage = parseArg("image", process.env.RUNPOD_WORKER_IMAGE?.trim() || undefined) ?? null;
  const workerName = parseArg("worker-name", `pararia-ux-${profileName}-reuse`) ?? `pararia-ux-${profileName}-reuse`;
  const prepareFresh = readBoolArg("prepare-fresh", true);
  const containerRegistryAuthId = parseArg(
    "registry-auth-id",
    process.env.RUNPOD_WORKER_CONTAINER_REGISTRY_AUTH_ID?.trim() || ""
  );

  if (!existsSync(sourceAudioPath)) {
    throw new Error(`source audio not found: ${sourceAudioPath}`);
  }

  await mkdir(outputDir, { recursive: true });
  await loadLocalEnvFiles();
  await loadEnvFile(fallbackEnvFile, { overrideExisting: true, optional: true });
  assertExistingStudentTargetAllowed(targetStudentName);

  if (!workerImage) {
    const { getRunpodWorkerConfig } = await import("../lib/runpod/worker-control");
    workerImage = getRunpodWorkerConfig()?.image ?? null;
  }

  process.env.PARARIA_BACKGROUND_MODE = "external";
  process.env.PARARIA_AUDIO_STORAGE_MODE = "blob";
  process.env.PARARIA_AUDIO_BLOB_ACCESS = "private";
  process.env.NEXT_PUBLIC_AUDIO_STORAGE_MODE = "blob";

  must(process.env.DATABASE_URL, "DATABASE_URL is required.");
  must(process.env.DIRECT_URL, "DIRECT_URL is required.");
  must(process.env.BLOB_READ_WRITE_TOKEN, "BLOB_READ_WRITE_TOKEN is required.");
  must(process.env.OPENAI_API_KEY, "OPENAI_API_KEY is required.");
  must(process.env.RUNPOD_API_KEY, "RUNPOD_API_KEY is required.");
  must(workerImage, "worker image is required.");

  const result: RunpodMeasureResult = {
    ok: false,
    profile: profile.name,
    gpu: profile.gpu,
    startupMode,
    workerImage,
    workerName: startupMode === "reuse" ? workerName : null,
    interruptible,
    sourceAudioPath,
    audioDurationSeconds: null,
    enqueueStartedAt: new Date().toISOString(),
    recordsKept: keepRecords,
  };

  let clipAudioPath: string | null = null;
  let uploadedStorageUrl: string | null = null;
  let createdStudentId: string | null = null;
  let createdSessionId: string | null = null;
  let createdPartId: string | null = null;
  let createdConversationId: string | null = null;
  let podId: string | null = null;
  let keepStoppedPod = false;

  try {
    const [
      { prisma },
      { SessionPartStatus, SessionPartType, SessionStatus, SessionType, ConversationSourceType, JobStatus, ConversationStatus },
      { saveSessionPartUpload },
      { enqueueSessionPartJob },
      { updateSessionStatusFromParts },
      { toSessionPartMetaJson, readSessionPartMeta },
      { getAudioDurationSeconds },
      { getAudioExpiryDate },
      { checkAudioBlobWriteHealth },
      { checkLlmApiHealth },
    ] = await Promise.all([
      import("../lib/db"),
      import("@prisma/client"),
      import("../lib/session-part-storage"),
      import("../lib/jobs/sessionPartJobs"),
      import("../lib/session-service"),
      import("../lib/session-part-meta"),
      import("../lib/audio-processing"),
      import("../lib/system-config"),
      import("../lib/audio-storage-health"),
      import("../lib/ai/llm-health"),
    ]);

    const blobHealth = await checkAudioBlobWriteHealth();
    if (!blobHealth.ok) {
      throw new Error(blobHealth.message);
    }
    const llmHealth = await checkLlmApiHealth();
    if (!llmHealth.ok) {
      throw new Error(llmHealth.message);
    }

    if (startupMode === "reuse") {
      if (prepareFresh) {
        await terminatePodsByName(workerName);
      }
      const prepared = await createDirectWorkerPod({
        profile,
        sessionId: "__prepare__",
        autoStopIdleMs,
        name: workerName,
        interruptible,
        createRetries,
        createRetryWaitMs,
        image: must(workerImage, "worker image is required for reuse startup."),
        containerRegistryAuthId: containerRegistryAuthId || null,
      });
      result.reusePreparedPodId = prepared.podId;
      result.reusePreparedAt = prepared.requestedAt.toISOString();
      await waitForWorkerReady(prepared.podId, timeoutMs, pollMs);
      await stopRunpodPod(prepared.podId);
      podId = prepared.podId;
      keepStoppedPod = true;
    }

    let measureAudioPath = sourceAudioPath;
    if (clipDurationSeconds > 0) {
      clipAudioPath = path.join(outputDir, `runpod-ux-${profileName}-${Date.now()}-${randomUUID()}.m4a`);
      await createAudioClip(sourceAudioPath, clipAudioPath, clipStartSeconds, clipDurationSeconds);
      measureAudioPath = clipAudioPath;
      result.clipAudioPath = clipAudioPath;
      result.clipStartSeconds = clipStartSeconds;
      result.clipDurationSeconds = clipDurationSeconds;
    }

    result.audioDurationSeconds = await getAudioDurationSeconds(measureAudioPath).catch(() => null);

    const organization = await prisma.organization.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!organization) throw new Error("organization not found in target database.");

    const user = await prisma.user.findFirst({
      where: { organizationId: organization.id },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    if (!user) throw new Error("user not found in target database.");

    const enqueueStartedAt = new Date();
    result.enqueueStartedAt = enqueueStartedAt.toISOString();

    let studentId: string;
    if (targetStudentName) {
      const matchingStudents = await prisma.student.findMany({
        where: {
          organizationId: organization.id,
          archivedAt: null,
          name: targetStudentName,
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true },
      });
      if (matchingStudents.length !== 1) {
        throw new Error(
          `student-name "${targetStudentName}" は ${matchingStudents.length} 件ヒットしました。正確に1件だけになる状態で再実行してください。`
        );
      }
      studentId = matchingStudents[0].id;
      result.studentId = matchingStudents[0].id;
      result.studentName = matchingStudents[0].name;
    } else {
      const student = await prisma.student.create({
        data: {
          organizationId: organization.id,
          name: `[Runpod UX ${profile.name}] ${enqueueStartedAt.toISOString().slice(11, 19)}`,
          grade: "計測用",
          course: `runpod-ux-${profile.name}`,
        },
        select: { id: true, name: true },
      });
      createdStudentId = student.id;
      studentId = student.id;
      result.studentId = student.id;
      result.studentName = student.name;
    }

    const session = await prisma.session.create({
      data: {
        organizationId: organization.id,
        studentId,
        userId: user.id,
        type: SessionType.INTERVIEW,
        status: SessionStatus.COLLECTING,
        title: targetStudentName ? `Runpod UX ${profile.name} ${targetStudentName}` : `Runpod UX ${profile.name}`,
        sessionDate: enqueueStartedAt,
      },
      select: { id: true },
    });
    createdSessionId = session.id;
    result.sessionId = session.id;

    const podPromise =
      startupMode === "reuse"
        ? (async () => {
            const preparedPodId = must(podId, "prepared pod id is required for reuse startup.");
            await patchRunpodPodWorkerConfig({
              podId: preparedPodId,
              profile,
              sessionId: session.id,
              autoStopIdleMs,
            });
            const requestedAt = new Date();
            await startRunpodPod(preparedPodId);
            return {
              podId: preparedPodId,
              requestedAt,
              attempt: 0,
            };
          })()
        : startupMode === "direct"
          ? createDirectWorkerPod({
              profile,
              sessionId: session.id,
              autoStopIdleMs,
              name: `pararia-ux-${profile.name}-${Date.now()}`,
              interruptible,
              createRetries,
              createRetryWaitMs,
              image: must(workerImage, "worker image is required for direct startup."),
              containerRegistryAuthId: containerRegistryAuthId || null,
            })
          : createBootstrapWorkerPod({
              profile,
              gitRef,
              sessionId: session.id,
              autoStopIdleMs,
              name: `pararia-ux-${profile.name}-${Date.now()}`,
              interruptible,
              createRetries,
              createRetryWaitMs,
            });

    const audioBuffer = await readFile(measureAudioPath);
    const stored = await saveSessionPartUpload({
      sessionId: session.id,
      partType: SessionPartType.FULL,
      fileName: path.basename(measureAudioPath),
      buffer: audioBuffer,
      contentType: clipDurationSeconds > 0 ? "audio/mp4" : "audio/mpeg",
    });
    uploadedStorageUrl = stored.storageUrl;

    const part = await prisma.sessionPart.create({
      data: {
        sessionId: session.id,
        partType: SessionPartType.FULL,
        sourceType: ConversationSourceType.AUDIO,
        status: SessionPartStatus.TRANSCRIBING,
        fileName: path.basename(measureAudioPath),
        mimeType: clipDurationSeconds > 0 ? "audio/mp4" : "audio/mpeg",
        byteSize: stored.byteSize,
        storageUrl: stored.storageUrl,
        rawTextOriginal: "",
        rawTextCleaned: "",
        reviewedText: null,
        reviewState: "NONE",
        rawSegments: [],
        qualityMetaJson: toSessionPartMetaJson(
          {},
          {
            pipelineStage: "TRANSCRIBING",
            uploadMode: "file_upload",
            captureSource: "file_upload",
            lastAcceptedAt: enqueueStartedAt.toISOString(),
            lastQueuedAt: enqueueStartedAt.toISOString(),
            uploadedFileName: path.basename(measureAudioPath),
            uploadedMimeType: clipDurationSeconds > 0 ? "audio/mp4" : "audio/mpeg",
            uploadedBytes: stored.byteSize,
            audioDurationSeconds: result.audioDurationSeconds,
            transcriptionPhase: "PREPARING_STT",
            transcriptionPhaseUpdatedAt: enqueueStartedAt.toISOString(),
            sttEngine: "faster-whisper",
          }
        ),
        transcriptExpiresAt: getAudioExpiryDate(),
      },
      select: { id: true },
    });
    createdPartId = part.id;
    result.partId = part.id;

    await updateSessionStatusFromParts(session.id);
    await enqueueSessionPartJob(part.id, "TRANSCRIBE_FILE");

    const pod = await podPromise;
    podId = pod.podId;
    result.podId = podId;
    result.createAttempts = pod.attempt;

    const readiness = await waitForWorkerReady(podId, timeoutMs, pollMs, pod.requestedAt.getTime());
    result.podReadyAt = readiness.checkedAt.toISOString();
    result.podReadyMs = readiness.checkedAt.getTime() - pod.requestedAt.getTime();
    applyRunpodWorkerMetadata(result, readiness.readiness);

    const timeoutAt = Date.now() + timeoutMs;
    while (Date.now() < timeoutAt) {
      const currentSession = await prisma.session.findUnique({
        where: { id: session.id },
        include: {
          parts: {
            include: {
              jobs: true,
            },
          },
          conversation: {
            include: {
              jobs: true,
            },
          },
        },
      });

      if (!currentSession) {
        throw new Error("session disappeared during polling.");
      }

      const currentPart = currentSession.parts.find((item: any) => item.partType === SessionPartType.FULL) ?? null;
      const partMeta = readSessionPartMeta(currentPart?.qualityMetaJson);
      applyRunpodWorkerMetadata(result, partMeta);
      const currentConversation = currentSession.conversation;
      const finalizeJob = currentConversation?.jobs.find((job: any) => job.type === "FINALIZE") ?? null;

      result.conversationId = currentConversation?.id ?? null;
      createdConversationId = currentConversation?.id ?? null;

      if (currentPart?.status === "ERROR") {
        throw new Error(`session part failed: ${String(partMeta.lastError ?? "unknown error")}`);
      }
      if (currentConversation?.status === ConversationStatus.ERROR) {
        throw new Error(
          `conversation finalize failed: ${String(finalizeJob?.lastError ?? currentConversation?.qualityMetaJson ?? "unknown error")}`
        );
      }

      if (!result.sttCompletedAt && currentPart?.status === SessionPartStatus.READY) {
        const completedAt = typeof partMeta.lastCompletedAt === "string" ? new Date(partMeta.lastCompletedAt) : new Date();
        result.sttCompletedAt = completedAt.toISOString();
        result.queueToSttMs = completedAt.getTime() - enqueueStartedAt.getTime();
        result.sttSeconds = typeof partMeta.sttSeconds === "number" ? partMeta.sttSeconds : null;
        result.sttPrepareMs = typeof partMeta.sttPrepareMs === "number" ? partMeta.sttPrepareMs : null;
        result.sttTranscribeMs = typeof partMeta.sttTranscribeMs === "number" ? partMeta.sttTranscribeMs : null;
        result.sttTranscribeWorkerMs =
          typeof partMeta.sttTranscribeWorkerMs === "number" ? partMeta.sttTranscribeWorkerMs : null;
        result.sttFinalizeMs = typeof partMeta.sttFinalizeMs === "number" ? partMeta.sttFinalizeMs : null;
        result.sttVadParameters =
          partMeta.sttVadParameters && typeof partMeta.sttVadParameters === "object" && !Array.isArray(partMeta.sttVadParameters)
            ? (partMeta.sttVadParameters as Record<string, number>)
            : null;
        result.sttModel = typeof partMeta.sttModel === "string" ? partMeta.sttModel : null;
        result.sttDevice = typeof partMeta.sttDevice === "string" ? partMeta.sttDevice : null;
        result.sttComputeType = typeof partMeta.sttComputeType === "string" ? partMeta.sttComputeType : null;
        result.sttPipeline = typeof partMeta.sttPipeline === "string" ? partMeta.sttPipeline : null;
        result.sttBatchSize = typeof partMeta.sttBatchSize === "number" ? partMeta.sttBatchSize : null;
        result.transcriptChars = currentPart.rawTextOriginal?.length ?? null;
      }

      if (currentConversation?.status === ConversationStatus.DONE && finalizeJob?.status === JobStatus.DONE) {
        const completedAt = finalizeJob.completedAt ?? finalizeJob.finishedAt ?? new Date();
        const qualityMeta =
          currentConversation.qualityMetaJson && typeof currentConversation.qualityMetaJson === "object" && !Array.isArray(currentConversation.qualityMetaJson)
            ? (currentConversation.qualityMetaJson as Record<string, unknown>)
            : {};
        const finalizeMeta = asObjectRecord(qualityMeta.finalizeJob);

        result.conversationCompletedAt = completedAt.toISOString();
        result.queueToConversationMs = completedAt.getTime() - enqueueStartedAt.getTime();
        result.finalizeCompletedAt = readIsoString(finalizeMeta?.finalizeCompletedAt) ?? result.conversationCompletedAt;
        result.finalizeDurationMs = typeof finalizeJob.lastRunDurationMs === "number" ? finalizeJob.lastRunDurationMs : null;
        result.finalizeQueueLagMs = typeof finalizeJob.lastQueueLagMs === "number" ? finalizeJob.lastQueueLagMs : null;
        result.llmApiCalls = typeof qualityMeta.llmApiCallsFinalize === "number" ? qualityMeta.llmApiCallsFinalize : null;
        result.llmInputTokens = typeof qualityMeta.llmInputTokensActual === "number" ? qualityMeta.llmInputTokensActual : null;
        result.llmCachedInputTokens =
          typeof qualityMeta.llmCachedInputTokensActual === "number" ? qualityMeta.llmCachedInputTokensActual : null;
        result.llmCachedInputRatio =
          result.llmInputTokens && result.llmCachedInputTokens !== null && result.llmInputTokens > 0
            ? Math.round((result.llmCachedInputTokens / result.llmInputTokens) * 1000) / 1000
            : null;
        result.llmOutputTokens = typeof qualityMeta.llmOutputTokensActual === "number" ? qualityMeta.llmOutputTokensActual : null;
        result.llmCostUsd = typeof qualityMeta.llmCostUsd === "number" ? qualityMeta.llmCostUsd : null;
        result.promptCacheKey = typeof qualityMeta.promptCacheKey === "string" ? qualityMeta.promptCacheKey : null;
        result.promptCacheRetention =
          qualityMeta.promptCacheRetention === "in_memory" || qualityMeta.promptCacheRetention === "24h"
            ? qualityMeta.promptCacheRetention
            : null;
        result.promptCacheStablePrefixChars =
          typeof qualityMeta.promptCacheStablePrefixChars === "number"
            ? qualityMeta.promptCacheStablePrefixChars
            : null;
        result.promptCacheStablePrefixTokensEstimate =
          typeof qualityMeta.promptCacheStablePrefixTokensEstimate === "number"
            ? qualityMeta.promptCacheStablePrefixTokensEstimate
            : null;
        result.finalizeModel = typeof qualityMeta.modelFinalize === "string" ? qualityMeta.modelFinalize : null;
        result.artifactChars = currentConversation.summaryMarkdown?.length ?? null;
        result.promotionCompletedAt = readIsoString(finalizeMeta?.promotionCompletedAt);
        result.conversationKickRequestedAt = readIsoString(finalizeMeta?.conversationKickRequestedAt);
        result.conversationKickDeferredAt = readIsoString(finalizeMeta?.conversationKickDeferredAt);
        result.conversationKickDeferredReason = readIsoString(finalizeMeta?.conversationKickDeferredReason);
        result.conversationAppDispatchStartedAt = readIsoString(finalizeMeta?.conversationAppDispatchStartedAt);
        result.conversationAppDispatchBlockedAt = readIsoString(finalizeMeta?.conversationAppDispatchBlockedAt);
        result.conversationAppDispatchBlockedReason = readIsoString(finalizeMeta?.conversationAppDispatchBlockedReason);
        result.conversationAppDispatchCompletedAt = readIsoString(finalizeMeta?.conversationAppDispatchCompletedAt);
        result.conversationJobClaimedAt = readIsoString(finalizeMeta?.conversationJobClaimedAt);
        result.reviewStartedAt = readIsoString(finalizeMeta?.reviewStartedAt);
        result.reviewCompletedAt = readIsoString(finalizeMeta?.reviewCompletedAt);
        result.finalizeStartedAt = readIsoString(finalizeMeta?.finalizeStartedAt);
        result.reviewDurationMs =
          typeof finalizeMeta?.reviewDurationMs === "number" ? finalizeMeta.reviewDurationMs : null;
        result.postSttTotalMs = diffIsoMs(result.sttCompletedAt, result.finalizeCompletedAt);
        result.sttToPromotionMs = diffIsoMs(result.sttCompletedAt, result.promotionCompletedAt);
        result.promotionToKickMs = diffIsoMs(result.promotionCompletedAt, result.conversationKickRequestedAt);
        result.kickDeferredToKickMs = diffIsoMs(result.conversationKickDeferredAt, result.conversationKickRequestedAt);
        result.kickToAppDispatchMs = diffIsoMs(result.conversationKickRequestedAt, result.conversationAppDispatchStartedAt);
        result.appDispatchToClaimMs = diffIsoMs(result.conversationAppDispatchStartedAt, result.conversationJobClaimedAt);
        result.claimToReviewStartMs = diffIsoMs(result.conversationJobClaimedAt, result.reviewStartedAt);
        if (result.reviewDurationMs === null) {
          result.reviewDurationMs = diffIsoMs(result.reviewStartedAt, result.reviewCompletedAt);
        }
        result.reviewToFinalizeMs = diffIsoMs(result.reviewCompletedAt, result.finalizeStartedAt);
        result.finalizeActiveMs = diffIsoMs(result.finalizeStartedAt, result.finalizeCompletedAt);
        const explainedPostSttMs = sumNumbers([
          result.sttToPromotionMs,
          result.promotionToKickMs,
          result.kickToAppDispatchMs,
          result.appDispatchToClaimMs,
          result.claimToReviewStartMs,
          result.reviewDurationMs,
          result.reviewToFinalizeMs,
          result.finalizeActiveMs,
        ]);
        result.postSttUnknownMs =
          result.postSttTotalMs !== null && explainedPostSttMs !== null
            ? Math.max(0, result.postSttTotalMs - explainedPostSttMs)
            : null;
        result.ok = true;
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    if (!result.ok) {
      throw new Error("timed out waiting for Runpod UX completion.");
    }
  } catch (error: any) {
    result.error = error?.message ?? String(error);
    process.exitCode = 1;
  } finally {
    await writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");
    if (keepStoppedPod && podId) {
      await stopRunpodPod(podId).catch(() => {});
    } else {
      await deleteRunpodPod(podId);
    }
    if (!keepRecords) {
      await cleanupBenchmarkRecords({
        sessionId: createdSessionId,
        studentId: createdStudentId,
        partId: createdPartId,
        conversationId: createdConversationId,
        storageUrl: uploadedStorageUrl,
      });
    }
    if (clipAudioPath) {
      await rm(clipAudioPath, { force: true }).catch(() => {});
    }
    console.log(JSON.stringify(result, null, 2));
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
