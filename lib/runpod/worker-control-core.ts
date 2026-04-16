export type RunpodPodLike = {
  id: string;
  name?: string | null;
  image?: string | null;
  imageName?: string | null;
  desiredStatus?: string | null;
  lastStartedAt?: string | null;
  createdAt?: string | null;
  env?: Record<string, string> | null;
  publicIp?: string | null;
  costPerHr?: string | number | null;
  adjustedCostPerHr?: number | null;
  machineId?: string | null;
  gpu?: {
    count?: number | null;
    displayName?: string | null;
  } | null;
};

export type RunpodPod = RunpodPodLike;

export type RunpodWorkerConfig = {
  apiKey: string;
  name: string;
  image: string;
  containerRegistryAuthId?: string | null;
  gpu: string;
  gpuCandidates: string[];
  secureCloud: boolean;
  containerDiskInGb: number;
  volumeInGb: number;
  gpuCount: number;
  autoStopIdleMs: number;
  apiTimeoutMs: number;
};

export type RunpodWorkerEnsureResult = {
  action: "already_running" | "started_existing" | "created_new";
  pod: RunpodPod;
  terminatedPodIds?: string[];
};

export type RunpodWorkerWakeResult = {
  attempted: boolean;
  ok: boolean;
  skipped?: string;
  error?: string;
  action?: RunpodWorkerEnsureResult["action"];
  podId?: string;
  desiredStatus?: string | null;
  name?: string;
};

export type RunpodWorkerStopResult = {
  ok: boolean;
  stoppedPodIds: string[];
  alreadyStoppedPodIds: string[];
  skipped?: string;
  error?: string;
};

export type RunpodWorkerTerminateResult = {
  ok: boolean;
  terminatedPodIds: string[];
  skipped?: string;
  error?: string;
};

export {
  buildRunpodWorkerCreateBody,
  buildRunpodWorkerEnv,
  getManagedRunpodPods,
  getRunpodPodsByName,
  getRunpodGpuCandidates,
  getRunpodPodById,
  getRunpodWorkerConfig,
  isActivePod,
  isRunpodCapacityErrorMessage,
  isRunningPod,
  isStoppedPod,
  isTerminatedPod,
  listRunpodPods,
  readPodStatus,
  runpodRequest,
  sleep,
  warnIfWorkerImageLooksMutable,
} from "./worker-control-internals";
