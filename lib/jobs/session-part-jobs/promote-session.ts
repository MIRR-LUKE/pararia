import { ConversationSourceType, JobStatus, SessionPartStatus, SessionPartType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { readFirstEnvValue } from "@/lib/env";
import { ensureConversationForSession } from "@/lib/session-service";
import { enqueueConversationJobs, processAllConversationJobs } from "@/lib/jobs/conversationJobs";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import { kickConversationJobsOutsideRunpod } from "@/lib/jobs/conversation-jobs/app-dispatch";
import { toPrismaJson } from "@/lib/prisma-json";
import { toSessionPartMetaJson } from "@/lib/session-part-meta";
import { type SessionPartJobPayload, type SessionPartPayload } from "./shared";

type PromoteConversationDispatchDeps = {
  enqueueConversationJobs: typeof enqueueConversationJobs;
  processAllConversationJobs: typeof processAllConversationJobs;
  shouldRunBackgroundJobsInline: typeof shouldRunBackgroundJobsInline;
};

function readConversationMetaRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

function readFinalizeJobMeta(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

async function mergeConversationFinalizeMeta(
  conversationId: string,
  patch: Record<string, unknown>
) {
  const existing = await prisma.conversationLog.findUnique({
    where: { id: conversationId },
    select: {
      qualityMetaJson: true,
    },
  });
  if (!existing) return;

  const previousMeta = readConversationMetaRecord(existing.qualityMetaJson);
  const previousFinalizeJob = readFinalizeJobMeta(previousMeta.finalizeJob);

  await prisma.conversationLog.update({
    where: { id: conversationId },
    data: {
      qualityMetaJson: toPrismaJson({
        ...previousMeta,
        finalizeJob: {
          ...previousFinalizeJob,
          ...patch,
        },
      }),
    },
  });
}

export async function dispatchPromotedConversationJobs(
  conversationId: string,
  deps: PromoteConversationDispatchDeps = {
    enqueueConversationJobs,
    processAllConversationJobs,
    shouldRunBackgroundJobsInline,
  }
) {
  await deps.enqueueConversationJobs(conversationId);

  if (deps.shouldRunBackgroundJobsInline()) {
    void deps.processAllConversationJobs(conversationId).catch((error) => {
      console.error("[sessionPartJobs] Background conversation processing failed:", error);
    });
    return {
      mode: "inline" as const,
      workerWake: null,
    };
  }

  return {
    mode: "external" as const,
    workerWake: null,
  };
}

type PromoteConversationKickDeps = {
  kickConversationJobsOutsideRunpod?: typeof kickConversationJobsOutsideRunpod;
  isRunpodWorkerProcess?: () => boolean;
  requireRunpodStopped?: boolean;
};

type PromoteConversationRemoteDispatchDeps = {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  maintenanceSecret?: string;
  requireRunpodStopped?: boolean;
};

export function kickPromotedConversationJobsOutsideRunpod(
  conversationId: string,
  dispatchMode: "inline" | "external",
  deps: PromoteConversationKickDeps = {}
) {
  const isRunpodWorkerProcess =
    deps.isRunpodWorkerProcess ?? (() => Boolean(process.env.RUNPOD_POD_ID?.trim()));

  if (dispatchMode !== "external" || isRunpodWorkerProcess()) {
    return false;
  }

  const kickConversationJobs = deps.kickConversationJobsOutsideRunpod ?? kickConversationJobsOutsideRunpod;
  kickConversationJobs(
    conversationId,
    "sessionPartJobs promote app conversation processing",
    {
      requireRunpodStopped: deps.requireRunpodStopped ?? true,
    }
  );
  return true;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/$/, "");
}

function resolveConversationDispatchBaseUrl(explicitBaseUrl?: string) {
  const baseUrl = explicitBaseUrl?.trim() || readFirstEnvValue(["NEXT_PUBLIC_APP_URL", "NEXTAUTH_URL"]);
  if (!baseUrl) {
    throw new Error("conversation dispatch 用の公開 URL が未設定です。NEXT_PUBLIC_APP_URL か NEXTAUTH_URL が必要です。");
  }
  return trimTrailingSlash(baseUrl);
}

function resolveConversationDispatchSecret(explicitSecret?: string) {
  const secret =
    explicitSecret?.trim() ||
    readFirstEnvValue(["MAINTENANCE_SECRET", "CRON_SECRET", "MAINTENANCE_CRON_SECRET"]);
  if (!secret) {
    throw new Error("conversation dispatch 用の maintenance secret が未設定です。");
  }
  return secret;
}

export async function requestPromotedConversationJobsFromApp(
  conversationId: string,
  dispatchMode: "inline" | "external",
  deps: PromoteConversationRemoteDispatchDeps = {}
) {
  if (dispatchMode !== "external") {
    return false;
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const baseUrl = resolveConversationDispatchBaseUrl(deps.baseUrl);
  const maintenanceSecret = resolveConversationDispatchSecret(deps.maintenanceSecret);
  const response = await fetchImpl(`${baseUrl}/api/maintenance/conversations/${conversationId}/dispatch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-maintenance-secret": maintenanceSecret,
    },
    body: JSON.stringify({
      requireRunpodStopped: deps.requireRunpodStopped ?? true,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `remote conversation dispatch failed: ${response.status}${body ? ` ${body.slice(0, 200)}` : ""}`
    );
  }

  return true;
}

export async function executePromoteSessionJob(job: SessionPartJobPayload, part: SessionPartPayload) {
  const session = await prisma.session.findUnique({
    where: { id: part.sessionId },
    include: {
      parts: true,
      conversation: {
        select: {
          id: true,
        },
      },
    },
  });
  if (!session) {
    throw new Error("session not found");
  }

  const readyForGeneration = session.parts.some(
    (item) => item.partType === SessionPartType.FULL && item.status === SessionPartStatus.READY
  );

  if (!readyForGeneration) {
    await prisma.sessionPart.update({
      where: { id: part.id },
      data: {
        qualityMetaJson: toSessionPartMetaJson(part.qualityMetaJson, {
          pipelineStage: "WAITING_COUNTERPART",
        }),
      },
    });
    await prisma.sessionPartJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.DONE,
        finishedAt: new Date(),
        outputJson: toPrismaJson({
          waiting: true,
        }),
      },
    });
    return;
  }

  await prisma.sessionPart.update({
    where: { id: part.id },
    data: {
      qualityMetaJson: toSessionPartMetaJson(part.qualityMetaJson, {
        pipelineStage: "GENERATING",
      }),
    },
  });

  const ensured = await ensureConversationForSession(part.sessionId);
  const dispatch =
    ensured.state === "unchanged"
      ? { mode: "reused" as const, workerWake: null }
      : await dispatchPromotedConversationJobs(ensured.conversationId);
  const promotionCompletedAt = new Date().toISOString();
  const requireRunpodStopped = part.sourceType !== ConversationSourceType.MANUAL;

  await mergeConversationFinalizeMeta(ensured.conversationId, {
    promotionCompletedAt,
    conversationDispatchMode: dispatch.mode,
    conversationEnsureState: ensured.state,
    conversationKickRequireRunpodStopped: requireRunpodStopped,
  });

  let kicked = false;
  if (dispatch.mode === "external") {
    if (process.env.RUNPOD_POD_ID?.trim()) {
      kicked = await requestPromotedConversationJobsFromApp(ensured.conversationId, dispatch.mode, {
        requireRunpodStopped,
      });
    } else {
      kicked = kickPromotedConversationJobsOutsideRunpod(ensured.conversationId, dispatch.mode, {
        requireRunpodStopped,
      });
    }

    if (!kicked && process.env.RUNPOD_POD_ID?.trim()) {
      await mergeConversationFinalizeMeta(ensured.conversationId, {
        conversationKickRequestedAt: promotionCompletedAt,
        conversationKickDeferredAt: promotionCompletedAt,
        conversationKickDeferredReason: "runpod_worker_process",
        conversationKickFollowup: "session_progress_background_dispatch",
      });
    }
  }

  await prisma.sessionPartJob.update({
    where: { id: job.id },
    data: {
      status: JobStatus.DONE,
      finishedAt: new Date(),
      outputJson: toPrismaJson({
        conversationId: ensured.conversationId,
        ensureState: ensured.state,
        dispatchMode: dispatch.mode,
        workerWake: dispatch.workerWake,
      }),
    },
  });
}
