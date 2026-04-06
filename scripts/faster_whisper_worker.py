#!/usr/bin/env python3
import json
import os
import re
import subprocess
import sys
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


REQUIRE_CUDA = env_bool("FASTER_WHISPER_REQUIRE_CUDA", True)
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
    model_name = os.environ.get("FASTER_WHISPER_MODEL", "large-v3").strip() or "large-v3"
    requested_device = os.environ.get("FASTER_WHISPER_DEVICE", "auto").strip() or "auto"
    requested_compute_type = os.environ.get("FASTER_WHISPER_COMPUTE_TYPE", "auto").strip() or "auto"
    preferred_cuda_order, gpu_name, gpu_compute_capability = resolve_cuda_compute_order(requested_compute_type)

    if requested_device != "auto":
        if REQUIRE_CUDA and requested_device != "cuda":
            raise RuntimeError("FASTER_WHISPER_REQUIRE_CUDA=1 なので CPU 実行は許可されていません。")
        resolved_compute_type = preferred_cuda_order[0] if requested_device == "cuda" and preferred_cuda_order else requested_compute_type
        model = WhisperModel(model_name, device=requested_device, compute_type=resolved_compute_type)
        return model, model_name, requested_device, resolved_compute_type

    supported_cuda_compute_types = list(ctranslate2.get_supported_compute_types("cuda"))

    for compute_type in preferred_cuda_order:
        if not compute_type:
            continue
        if compute_type != "auto" and compute_type not in supported_cuda_compute_types and compute_type != "default":
            continue
        try:
            model = WhisperModel(model_name, device="cuda", compute_type=compute_type)
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
        model = WhisperModel(model_name, device="cuda", compute_type="default")
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
        model = WhisperModel(model_name, device="cpu", compute_type=cpu_compute_type)
        return model, model_name, "cpu", cpu_compute_type


MODEL, MODEL_NAME, MODEL_DEVICE, MODEL_COMPUTE_TYPE = choose_model()
DEFAULT_BEAM_SIZE = max(1, int(os.environ.get("FASTER_WHISPER_BEAM_SIZE", "1")))
DEFAULT_VAD_FILTER = env_bool("FASTER_WHISPER_VAD_FILTER", True)
DEFAULT_CONDITION_ON_PREVIOUS_TEXT = env_bool("FASTER_WHISPER_CONDITION_ON_PREVIOUS_TEXT", True)
DEFAULT_BATCH_SIZE = max(1, int(os.environ.get("FASTER_WHISPER_BATCH_SIZE", "8")))
BATCHED_PIPELINE = BatchedInferencePipeline(model=MODEL) if MODEL_DEVICE == "cuda" and DEFAULT_BATCH_SIZE > 1 else None


def transcribe(audio_path: str, language: str) -> Dict[str, Any]:
    transcribe_kwargs = dict(
        language=language or "ja",
        beam_size=DEFAULT_BEAM_SIZE,
        vad_filter=DEFAULT_VAD_FILTER,
        condition_on_previous_text=DEFAULT_CONDITION_ON_PREVIOUS_TEXT,
    )
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
