#!/usr/bin/env python3
import json
import os
import sys
from typing import Any, Dict, List

from faster_whisper import WhisperModel


def env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() not in {"0", "false", "no", "off"}


def choose_model() -> tuple[WhisperModel, str, str, str]:
    model_name = os.environ.get("FASTER_WHISPER_MODEL", "large-v3").strip() or "large-v3"
    requested_device = os.environ.get("FASTER_WHISPER_DEVICE", "auto").strip() or "auto"
    requested_compute_type = os.environ.get("FASTER_WHISPER_COMPUTE_TYPE", "int8_float16").strip() or "int8_float16"

    if requested_device != "auto":
        model = WhisperModel(model_name, device=requested_device, compute_type=requested_compute_type)
        return model, model_name, requested_device, requested_compute_type

    try:
        model = WhisperModel(model_name, device="cuda", compute_type=requested_compute_type)
        return model, model_name, "cuda", requested_compute_type
    except Exception as gpu_error:
        cpu_compute_type = os.environ.get("FASTER_WHISPER_CPU_COMPUTE_TYPE", "int8").strip() or "int8"
        print(
            f"[faster-whisper] CUDA startup failed, falling back to CPU: {gpu_error}",
            file=sys.stderr,
            flush=True,
        )
        model = WhisperModel(model_name, device="cpu", compute_type=cpu_compute_type)
        return model, model_name, "cpu", cpu_compute_type


MODEL, MODEL_NAME, MODEL_DEVICE, MODEL_COMPUTE_TYPE = choose_model()
DEFAULT_BEAM_SIZE = max(1, int(os.environ.get("FASTER_WHISPER_BEAM_SIZE", "5")))
DEFAULT_VAD_FILTER = env_bool("FASTER_WHISPER_VAD_FILTER", True)
DEFAULT_CONDITION_ON_PREVIOUS_TEXT = env_bool("FASTER_WHISPER_CONDITION_ON_PREVIOUS_TEXT", True)


def transcribe(audio_path: str, language: str) -> Dict[str, Any]:
    segments_iter, info = MODEL.transcribe(
        audio_path,
        language=language or "ja",
        beam_size=DEFAULT_BEAM_SIZE,
        vad_filter=DEFAULT_VAD_FILTER,
        condition_on_previous_text=DEFAULT_CONDITION_ON_PREVIOUS_TEXT,
    )

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
