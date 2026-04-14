import { buildBootstrapCommand, buildDirectStartCommand, buildWorkerEnv, getHeartbeatPath, patchRunpodPodWorkerConfig, runpodRequest, startRunpodPod, stopRunpodPod, terminatePodsByName, tryReadStorageJson } from "./runpod-measure-ux-runpod";
import { sleep } from "./runpod-measure-ux-core";
import { assertMeasurementStudent } from "./measurement-student-guard";

import type { GpuProfile } from "./runpod-measure-ux-runpod";

export async function createBootstrapWorkerPod(input: {
  profile: GpuProfile;
  gitRef: string;
  sessionId: string;
  autoStopIdleMs: number;
  name: string;
  interruptible: boolean;
  createRetries: number;
  createRetryWaitMs: number;
}) {
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= input.createRetries) {
    attempt += 1;
    try {
      const requestedAt = new Date();
      const created = await runpodRequest("/pods", {
        method: "POST",
        body: JSON.stringify({
          name: input.name,
          imageName: "runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04",
          gpuTypeIds: [input.profile.gpu],
          gpuCount: 1,
          cloudType: "COMMUNITY",
          interruptible: input.interruptible,
          containerDiskInGb: 30,
          volumeInGb: 0,
          dockerStartCmd: buildBootstrapCommand(input.gitRef),
          env: buildWorkerEnv({
            sessionId: input.sessionId,
            autoStopIdleMs: input.autoStopIdleMs,
            profile: input.profile,
          }),
        }),
      });

      const podId = String((created as Record<string, unknown>).id ?? "").trim();
      if (!podId) {
        throw new Error(`Runpod create did not return a pod id: ${JSON.stringify(created)}`);
      }

      return {
        podId,
        requestedAt,
        attempt,
      };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const retryable = /does not have the resources|no spot price found/i.test(message);
      if (!retryable || attempt > input.createRetries) {
        break;
      }
      await sleep(input.createRetryWaitMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "failed to create Runpod pod"));
}

export async function createDirectWorkerPod(input: {
  profile: GpuProfile;
  sessionId: string;
  autoStopIdleMs: number;
  name: string;
  interruptible: boolean;
  createRetries: number;
  createRetryWaitMs: number;
  image: string;
  containerRegistryAuthId?: string | null;
}) {
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= input.createRetries) {
    attempt += 1;
    try {
      const requestedAt = new Date();
      const created = await runpodRequest("/pods", {
        method: "POST",
        body: JSON.stringify({
          name: input.name,
          imageName: input.image,
          containerRegistryAuthId: input.containerRegistryAuthId || undefined,
          gpuTypeIds: [input.profile.gpu],
          gpuCount: 1,
          cloudType: "COMMUNITY",
          interruptible: input.interruptible,
          containerDiskInGb: 30,
          volumeInGb: 0,
        }),
      });

      const podId = String((created as Record<string, unknown>).id ?? "").trim();
      if (!podId) {
        throw new Error(`Runpod create did not return a pod id: ${JSON.stringify(created)}`);
      }

      await runpodRequest(`/pods/${podId}`, {
        method: "PATCH",
        body: JSON.stringify({
          dockerStartCmd: buildDirectStartCommand(),
          env: buildWorkerEnv({
            sessionId: input.sessionId,
            autoStopIdleMs: input.autoStopIdleMs,
            profile: input.profile,
          }),
        }),
      });

      return {
        podId,
        requestedAt,
        attempt,
      };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const retryable = /does not have the resources|no spot price found/i.test(message);
      if (!retryable || attempt > input.createRetries) {
        break;
      }
      await sleep(input.createRetryWaitMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "failed to create Runpod pod"));
}

export async function waitForWorkerReady(podId: string, timeoutMs: number, pollMs: number, minCheckedAtMs?: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const dbOk = await tryReadStorageJson(getHeartbeatPath(podId, "db-ok.json"));
    if (dbOk) {
      const checkedAt = typeof dbOk.checkedAt === "string" ? new Date(dbOk.checkedAt) : new Date();
      if (!minCheckedAtMs || checkedAt.getTime() >= minCheckedAtMs) {
        return {
          ok: true,
          readiness: dbOk,
          checkedAt,
        };
      }
    }

    const dbError = await tryReadStorageJson(getHeartbeatPath(podId, "db-error.json"));
    if (dbError) {
      throw new Error(`worker reported startup db error: ${String(dbError.error ?? "unknown error")}`);
    }

    const pod = await runpodRequest(`/pods/${podId}`, { method: "GET" });
    const status = String((pod as Record<string, unknown>).desiredStatus ?? "").trim().toUpperCase();
    if (status === "EXITED" || status === "STOPPED" || status === "TERMINATED") {
      throw new Error(`pod ${podId} left RUNNING before readiness (${status})`);
    }

    await sleep(pollMs);
  }

  throw new Error(`timed out waiting for worker readiness for pod ${podId}`);
}

export async function deleteRunpodPod(podId: string | null | undefined) {
  if (!podId) return;
  await runpodRequest(`/pods/${podId}`, { method: "DELETE" }).catch(() => {});
}

export async function cleanupBenchmarkRecords(input: {
  sessionId: string | null;
  studentId: string | null;
  partId: string | null;
  conversationId: string | null;
  storageUrl: string | null;
}) {
  const [{ prisma }, { deleteStorageEntry }] = await Promise.all([
    import("../../lib/db"),
    import("../../lib/audio-storage"),
  ]);

  try {
    if (input.storageUrl) {
      await deleteStorageEntry(input.storageUrl).catch(() => {});
    }
    if (input.conversationId) {
      await prisma.conversationJob.deleteMany({ where: { conversationId: input.conversationId } }).catch(() => {});
      await prisma.conversationLog.deleteMany({ where: { id: input.conversationId } }).catch(() => {});
    }
    if (input.partId) {
      await prisma.sessionPartJob.deleteMany({ where: { sessionPartId: input.partId } }).catch(() => {});
      await prisma.sessionPart.deleteMany({ where: { id: input.partId } }).catch(() => {});
    }
    if (input.sessionId) {
      await prisma.session.deleteMany({ where: { id: input.sessionId } }).catch(() => {});
    }
    if (input.studentId) {
      const student = await prisma.student.findUnique({
        where: { id: input.studentId },
        select: { id: true, name: true, grade: true, course: true },
      });
      assertMeasurementStudent(student, {
        namePrefix: "[Runpod UX ",
        allowedGrades: ["計測用"],
        coursePrefixes: ["runpod-ux-"],
      });
      await prisma.studentProfile.deleteMany({ where: { studentId: input.studentId } }).catch(() => {});
      await prisma.student.deleteMany({ where: { id: input.studentId } }).catch(() => {});
    }
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

export {
  buildBootstrapCommand,
  buildDirectStartCommand,
  buildWorkerEnv,
  getHeartbeatPath,
  patchRunpodPodWorkerConfig,
  startRunpodPod,
  stopRunpodPod,
  terminatePodsByName,
  tryReadStorageJson,
};
