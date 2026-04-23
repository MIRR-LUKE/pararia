#!/usr/bin/env python3
import json
import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Sequence

import ctranslate2
from faster_whisper import BatchedInferencePipeline, WhisperModel

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="strict")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() not in {"0", "false", "no", "off"}


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw.strip())
    except ValueError:
        return default


def env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return float(raw.strip())
    except ValueError:
        return default


def resolve_download_root() -> str | None:
    explicit = os.environ.get("FASTER_WHISPER_DOWNLOAD_ROOT", "").strip()
    if explicit:
        Path(explicit).mkdir(parents=True, exist_ok=True)
        return explicit

    workspace_dir = os.environ.get("PARARIA_RUNPOD_WORKSPACE_DIR", "").strip()
    if workspace_dir:
        root = Path(workspace_dir) / ".cache" / "faster-whisper"
        root.mkdir(parents=True, exist_ok=True)
        return str(root)

    return None


REQUIRE_CUDA = env_bool("FASTER_WHISPER_REQUIRE_CUDA", True)
DOWNLOAD_ROOT = resolve_download_root()
UNSAFE_BLACKWELL_INT8_TYPES = {
    "int8",
    "int8_float16",
    "int8_float32",
    "int8_bfloat16",
}


def read_primary_gpu_name() -> str:
    override = os.environ.get("FASTER_WHISPER_GPU_NAME", "").strip()
    if override:
        return override

    try:
        completed = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            check=True,
            capture_output=True,
            text=True,
        )
        for line in completed.stdout.splitlines():
            name = line.strip()
            if name:
                return name
    except Exception:
        pass

    return ""


def read_primary_gpu_compute_capability() -> str:
    override = os.environ.get("FASTER_WHISPER_GPU_COMPUTE_CAPABILITY", "").strip()
    if override:
        return override

    try:
        completed = subprocess.run(
            ["nvidia-smi", "--query-gpu=compute_cap", "--format=csv,noheader"],
            check=True,
            capture_output=True,
            text=True,
        )
        for line in completed.stdout.splitlines():
            capability = line.strip()
            if capability:
                return capability
    except Exception:
        pass

    return ""


def read_primary_gpu_snapshot() -> Dict[str, int] | None:
    try:
        completed = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=utilization.gpu,memory.used,memory.total",
                "--format=csv,noheader,nounits",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        for line in completed.stdout.splitlines():
            raw = [part.strip() for part in line.split(",")]
            if len(raw) < 3:
                continue
            utilization_gpu_percent = int(float(raw[0]))
            memory_used_mb = int(float(raw[1]))
            memory_total_mb = int(float(raw[2]))
            return {
                "utilization_gpu_percent": utilization_gpu_percent,
                "memory_used_mb": memory_used_mb,
                "memory_total_mb": memory_total_mb,
            }
    except Exception:
        pass

    return None


def monitor_primary_gpu_activity(
    stop_event: threading.Event,
    samples: List[Dict[str, int]],
    interval_seconds: float = 0.5,
) -> None:
    while not stop_event.is_set():
        snapshot = read_primary_gpu_snapshot()
        if snapshot is not None:
            samples.append(
                {
                    **snapshot,
                    "sampled_at_ms": int(time.time() * 1000),
                }
            )
        if stop_event.wait(interval_seconds):
            break


def summarize_gpu_samples(samples: Sequence[Dict[str, int]]) -> Dict[str, Any] | None:
    if not samples:
        return None

    utilization_samples = [sample["utilization_gpu_percent"] for sample in samples]
    memory_used_samples = [sample["memory_used_mb"] for sample in samples]
    memory_total_samples = [sample["memory_total_mb"] for sample in samples]

    return {
        "sample_count": len(samples),
        "utilization_percent_max": max(utilization_samples),
        "utilization_percent_avg": round(sum(utilization_samples) / len(utilization_samples), 1),
        "memory_used_mb_max": max(memory_used_samples),
        "memory_used_mb_min": min(memory_used_samples),
        "memory_total_mb": max(memory_total_samples),
        "sampled_at_ms_start": samples[0]["sampled_at_ms"],
        "sampled_at_ms_end": samples[-1]["sampled_at_ms"],
    }


def is_blackwell_gpu(gpu_name: str, compute_capability: str) -> bool:
    normalized_name = gpu_name.lower()
    normalized_capability = compute_capability.strip()
    if normalized_capability.startswith("12"):
        return True
    return bool(re.search(r"rtx\s*50\d{2}", normalized_name))


def dedupe_order(values: Sequence[str]) -> List[str]:
    seen = set()
    ordered: List[str] = []
    for value in values:
        if not value or value in seen:
            continue
        ordered.append(value)
        seen.add(value)
    return ordered


def resolve_cuda_compute_order(requested_compute_type: str) -> tuple[List[str], str, str]:
    gpu_name = read_primary_gpu_name()
    compute_capability = read_primary_gpu_compute_capability()
    blackwell = is_blackwell_gpu(gpu_name, compute_capability)

    if blackwell:
        safe_blackwell_order = [
            "float16",
            "bfloat16",
            "float32",
            "auto",
            "default",
        ]
        if requested_compute_type in UNSAFE_BLACKWELL_INT8_TYPES:
            requested_first: List[str] = []
        elif requested_compute_type == "auto":
            requested_first = []
        else:
            requested_first = [requested_compute_type]
        if requested_compute_type in UNSAFE_BLACKWELL_INT8_TYPES:
            print(
                (
                    f"[faster-whisper] detected Blackwell GPU ({gpu_name or 'unknown'}, cc={compute_capability or 'unknown'}) "
                    f"and overriding unsafe compute_type={requested_compute_type} -> float16"
                ),
                file=sys.stderr,
                flush=True,
            )
        elif requested_compute_type == "auto":
            print(
                (
                    f"[faster-whisper] detected Blackwell GPU ({gpu_name or 'unknown'}, cc={compute_capability or 'unknown'}) "
                    "and preferring float16/bfloat16 over int8 variants"
                ),
                file=sys.stderr,
                flush=True,
            )
        return dedupe_order([*requested_first, *safe_blackwell_order]), gpu_name, compute_capability

    default_order = [
        requested_compute_type,
        "int8_float16",
        "float16",
        "int8_float32",
        "int8",
        "float32",
        "default",
    ]
    return dedupe_order(default_order), gpu_name, compute_capability


def choose_model() -> tuple[WhisperModel, str, str, str]:
    model_name = os.environ.get("FASTER_WHISPER_MODEL", "turbo").strip() or "turbo"
    requested_device = os.environ.get("FASTER_WHISPER_DEVICE", "auto").strip() or "auto"
    requested_compute_type = os.environ.get("FASTER_WHISPER_COMPUTE_TYPE", "auto").strip() or "auto"
    preferred_cuda_order, gpu_name, gpu_compute_capability = resolve_cuda_compute_order(requested_compute_type)

    if requested_device != "auto":
        if REQUIRE_CUDA and requested_device != "cuda":
            raise RuntimeError("FASTER_WHISPER_REQUIRE_CUDA=1 なので CPU 実行は許可されていません。")
        resolved_compute_type = preferred_cuda_order[0] if requested_device == "cuda" and preferred_cuda_order else requested_compute_type
        model = WhisperModel(
            model_name,
            device=requested_device,
            compute_type=resolved_compute_type,
            download_root=DOWNLOAD_ROOT,
        )
        return model, model_name, requested_device, resolved_compute_type

    supported_cuda_compute_types = list(ctranslate2.get_supported_compute_types("cuda"))

    for compute_type in preferred_cuda_order:
        if not compute_type:
            continue
        if compute_type != "auto" and compute_type not in supported_cuda_compute_types and compute_type != "default":
            continue
        try:
            model = WhisperModel(
                model_name,
                device="cuda",
                compute_type=compute_type,
                download_root=DOWNLOAD_ROOT,
            )
            actual_compute_type = compute_type
            if compute_type == "auto":
                if is_blackwell_gpu(gpu_name, gpu_compute_capability):
                    if "float16" in supported_cuda_compute_types:
                        actual_compute_type = "float16"
                    elif "bfloat16" in supported_cuda_compute_types:
                        actual_compute_type = "bfloat16"
                    elif "float32" in supported_cuda_compute_types:
                        actual_compute_type = "float32"
                elif "int8_float16" in supported_cuda_compute_types:
                    actual_compute_type = "int8_float16"
                elif "float16" in supported_cuda_compute_types:
                    actual_compute_type = "float16"
                elif "int8_float32" in supported_cuda_compute_types:
                    actual_compute_type = "int8_float32"
                elif "int8" in supported_cuda_compute_types:
                    actual_compute_type = "int8"
                elif "float32" in supported_cuda_compute_types:
                    actual_compute_type = "float32"
            return model, model_name, "cuda", actual_compute_type
        except Exception:
            continue

    try:
        model = WhisperModel(model_name, device="cuda", compute_type="default", download_root=DOWNLOAD_ROOT)
        return model, model_name, "cuda", "default"
    except Exception as gpu_error:
        if REQUIRE_CUDA:
            raise RuntimeError(f"CUDA で faster-whisper を起動できませんでした: {gpu_error}") from gpu_error
        cpu_compute_type = os.environ.get("FASTER_WHISPER_CPU_COMPUTE_TYPE", "int8").strip() or "int8"
        print(
            f"[faster-whisper] CUDA startup failed, falling back to CPU: {gpu_error}",
            file=sys.stderr,
            flush=True,
        )
        model = WhisperModel(
            model_name,
            device="cpu",
            compute_type=cpu_compute_type,
            download_root=DOWNLOAD_ROOT,
        )
        return model, model_name, "cpu", cpu_compute_type


MODEL, MODEL_NAME, MODEL_DEVICE, MODEL_COMPUTE_TYPE = choose_model()
PRIMARY_GPU_NAME = read_primary_gpu_name()
PRIMARY_GPU_COMPUTE_CAPABILITY = read_primary_gpu_compute_capability()
DEFAULT_BEAM_SIZE = max(1, int(os.environ.get("FASTER_WHISPER_BEAM_SIZE", "1")))
DEFAULT_VAD_FILTER = env_bool("FASTER_WHISPER_VAD_FILTER", True)
DEFAULT_CONDITION_ON_PREVIOUS_TEXT = env_bool("FASTER_WHISPER_CONDITION_ON_PREVIOUS_TEXT", True)
DEFAULT_BATCH_SIZE = max(1, int(os.environ.get("FASTER_WHISPER_BATCH_SIZE", "8")))
DEFAULT_VAD_PARAMETERS = {
    "min_silence_duration_ms": env_int("FASTER_WHISPER_VAD_MIN_SILENCE_MS", 1000),
    "speech_pad_ms": env_int("FASTER_WHISPER_VAD_SPEECH_PAD_MS", 400),
    "threshold": env_float("FASTER_WHISPER_VAD_THRESHOLD", 0.5),
}
DEFAULT_MIN_SPEECH_DURATION_MS = env_int("FASTER_WHISPER_VAD_MIN_SPEECH_MS", 0)
if DEFAULT_MIN_SPEECH_DURATION_MS > 0:
    DEFAULT_VAD_PARAMETERS["min_speech_duration_ms"] = DEFAULT_MIN_SPEECH_DURATION_MS
BATCHED_PIPELINE = BatchedInferencePipeline(model=MODEL) if MODEL_DEVICE == "cuda" and DEFAULT_BATCH_SIZE > 1 else None

sys.stdout.write(
    json.dumps(
        {
            "event": "ready",
            "ok": True,
            "model": MODEL_NAME,
            "device": MODEL_DEVICE,
            "compute_type": MODEL_COMPUTE_TYPE,
            "pipeline": "batched" if BATCHED_PIPELINE is not None else "default",
            "batch_size": DEFAULT_BATCH_SIZE if BATCHED_PIPELINE is not None else 1,
            "gpu_name": PRIMARY_GPU_NAME,
            "gpu_compute_capability": PRIMARY_GPU_COMPUTE_CAPABILITY,
            "vad_parameters": DEFAULT_VAD_PARAMETERS,
            "download_root": DOWNLOAD_ROOT,
        },
        ensure_ascii=False,
    )
    + "\n"
)
sys.stdout.flush()


def transcribe(audio_path: str, language: str) -> Dict[str, Any]:
    transcribe_kwargs = dict(
        language=language or "ja",
        beam_size=DEFAULT_BEAM_SIZE,
        vad_filter=DEFAULT_VAD_FILTER,
        vad_parameters=DEFAULT_VAD_PARAMETERS,
        condition_on_previous_text=DEFAULT_CONDITION_ON_PREVIOUS_TEXT,
    )
    gpu_snapshot_before = read_primary_gpu_snapshot()
    gpu_samples: List[Dict[str, int]] = []
    gpu_monitor_stop = threading.Event()
    gpu_monitor_thread: threading.Thread | None = None

    if MODEL_DEVICE == "cuda":
        gpu_monitor_thread = threading.Thread(
            target=monitor_primary_gpu_activity,
            args=(gpu_monitor_stop, gpu_samples),
            daemon=True,
        )
        gpu_monitor_thread.start()

    try:
        transcribe_started_at = time.perf_counter()
        if BATCHED_PIPELINE is not None:
            segments_iter, info = BATCHED_PIPELINE.transcribe(
                audio_path,
                batch_size=DEFAULT_BATCH_SIZE,
                **transcribe_kwargs,
            )
            pipeline_kind = "batched"
        else:
            segments_iter, info = MODEL.transcribe(
                audio_path,
                **transcribe_kwargs,
            )
            pipeline_kind = "default"

        segments = list(segments_iter)
    finally:
        if gpu_monitor_thread is not None:
            gpu_monitor_stop.set()
            gpu_monitor_thread.join(timeout=2.0)

    transcribe_elapsed_ms = int((time.perf_counter() - transcribe_started_at) * 1000)

    gpu_snapshot_after = read_primary_gpu_snapshot()
    gpu_monitor_summary = summarize_gpu_samples(gpu_samples)
    payload_segments: List[Dict[str, Any]] = []
    for index, segment in enumerate(segments):
        text = (getattr(segment, "text", "") or "").strip()
        if not text:
            continue
        payload_segments.append(
            {
                "id": index,
                "start": float(getattr(segment, "start", 0.0) or 0.0),
                "end": float(getattr(segment, "end", 0.0) or 0.0),
                "text": text,
            }
        )

    text = "\n".join(segment["text"] for segment in payload_segments).strip()
    return {
        "text": text,
        "segments": payload_segments,
        "language": getattr(info, "language", language or "ja"),
        "model": MODEL_NAME,
        "device": MODEL_DEVICE,
        "compute_type": MODEL_COMPUTE_TYPE,
        "pipeline": pipeline_kind,
        "batch_size": DEFAULT_BATCH_SIZE if pipeline_kind == "batched" else 1,
        "gpu_name": PRIMARY_GPU_NAME,
        "gpu_compute_capability": PRIMARY_GPU_COMPUTE_CAPABILITY,
        "gpu_snapshot_before": gpu_snapshot_before,
        "gpu_snapshot_after": gpu_snapshot_after,
        "gpu_monitor": gpu_monitor_summary,
        "vad_parameters": DEFAULT_VAD_PARAMETERS,
        "transcribe_elapsed_ms": transcribe_elapsed_ms,
    }


for raw_line in sys.stdin:
    line = raw_line.strip()
    if not line:
        continue

    request_id = ""
    try:
        payload = json.loads(line)
        request_id = str(payload.get("id", "")).strip()
        if not request_id:
            raise ValueError("id is required")
        audio_path = str(payload.get("audio_path", "")).strip()
        if not audio_path:
            raise ValueError("audio_path is required")
        language = str(payload.get("language", "ja") or "ja").strip() or "ja"

        result = transcribe(audio_path, language)
        sys.stdout.write(
            json.dumps(
                {
                    "id": request_id,
                    "ok": True,
                    **result,
                },
                ensure_ascii=False,
            )
            + "\n"
        )
        sys.stdout.flush()
    except Exception as error:
        sys.stdout.write(
            json.dumps(
                {
                    "id": request_id,
                    "ok": False,
                    "error": str(error),
                },
                ensure_ascii=False,
            )
            + "\n"
        )
        sys.stdout.flush()
