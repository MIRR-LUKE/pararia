export type TranscribeInput = {
  buffer?: Buffer;
  filePath?: string;
  filename?: string;
  mimeType?: string;
  language?: string;
};

export type TranscriptSegment = {
  id?: number | string;
  seek?: number;
  start?: number;
  end?: number;
  text?: string;
  speaker?: string;
};

export type SegmentedTranscriptResult = {
  rawTextOriginal: string;
  segments: TranscriptSegment[];
};

export type TranscriptQualityWarning = "too_many_short_segments" | "adjacent_duplicates_removed";

export type WorkerGpuSnapshot = {
  utilization_gpu_percent?: number;
  memory_used_mb?: number;
  memory_total_mb?: number;
};

export type WorkerGpuMonitor = {
  sample_count?: number;
  utilization_percent_max?: number;
  utilization_percent_avg?: number;
  memory_used_mb_max?: number;
  memory_used_mb_min?: number;
  memory_total_mb?: number;
  sampled_at_ms_start?: number;
  sampled_at_ms_end?: number;
};

export type WorkerSegment = {
  id?: number | string;
  start?: number;
  end?: number;
  text?: string;
};

export type WorkerVadParameters = {
  min_silence_duration_ms?: number;
  speech_pad_ms?: number;
  threshold?: number;
  min_speech_duration_ms?: number;
};

export type WorkerRequest = {
  id: string;
  audio_path: string;
  language: string;
};

export type WorkerSuccessResponse = {
  id: string;
  ok: true;
  text?: string;
  segments?: WorkerSegment[];
  model?: string;
  device?: string;
  compute_type?: string;
  pipeline?: string;
  batch_size?: number;
  gpu_name?: string;
  gpu_compute_capability?: string;
  gpu_snapshot_before?: WorkerGpuSnapshot;
  gpu_snapshot_after?: WorkerGpuSnapshot;
  gpu_monitor?: WorkerGpuMonitor;
  vad_parameters?: WorkerVadParameters;
  transcribe_elapsed_ms?: number;
};

export type WorkerErrorResponse = {
  id: string;
  ok: false;
  error?: string;
};

export type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse;

export type WorkerReadyResponse = {
  event: "ready";
  ok: true;
  model?: string;
  device?: string;
  compute_type?: string;
  pipeline?: string;
  batch_size?: number;
  gpu_name?: string;
  gpu_compute_capability?: string;
  vad_parameters?: WorkerVadParameters;
};

export type FasterWhisperWorkerHandle = {
  warm(): Promise<WorkerReadyResponse>;
  transcribe(input: { audioPath: string; language: string }): Promise<WorkerSuccessResponse>;
  getLoad(): number;
  shutdown(): void;
};

export type FasterWhisperResponseFormat = "segments_json";

export type PipelineTranscriptionResult = SegmentedTranscriptResult & {
  meta: {
    model: string;
    responseFormat: FasterWhisperResponseFormat;
    recoveryUsed: boolean;
    fallbackUsed: false;
    attemptCount: number;
    segmentCount: number;
    speakerCount: 0;
    qualityWarnings: TranscriptQualityWarning[];
    device?: string;
    computeType?: string;
    pipeline?: string;
    batchSize?: number;
    gpuName?: string;
    gpuComputeCapability?: string;
    gpuSnapshotBefore?: WorkerGpuSnapshot;
    gpuSnapshotAfter?: WorkerGpuSnapshot;
    gpuMonitor?: WorkerGpuMonitor;
    vadParameters?: WorkerVadParameters;
    transcribeElapsedMs?: number;
  };
};
