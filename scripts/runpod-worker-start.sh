#!/usr/bin/env bash
set -euo pipefail

required_envs=(
  DATABASE_URL
  DIRECT_URL
  BLOB_READ_WRITE_TOKEN
  OPENAI_API_KEY
)

missing=0
for name in "${required_envs[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "[runpod-worker] missing required env: ${name}" >&2
    missing=1
  fi
done

if [[ "$missing" -ne 0 ]]; then
  exit 1
fi

echo "[runpod-worker] starting"
echo "[runpod-worker] background_mode=${PARARIA_BACKGROUND_MODE:-external} audio_storage=${PARARIA_AUDIO_STORAGE_MODE:-blob} model=${FASTER_WHISPER_MODEL:-large-v3} batch=${FASTER_WHISPER_BATCH_SIZE:-8}"

exec npm run worker:gpu
