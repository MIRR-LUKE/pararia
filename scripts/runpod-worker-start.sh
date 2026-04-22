#!/usr/bin/env bash
set -euo pipefail

workspace_dir="${PARARIA_RUNPOD_WORKSPACE_DIR:-/workspace}"
export PARARIA_RUNPOD_WORKSPACE_DIR="${workspace_dir}"
mkdir -p "${workspace_dir}/.cache/faster-whisper"
package_json="${workspace_dir}/package.json"
worker_script="${workspace_dir}/scripts/run-runpod-worker.ts"

if [[ ! -f "${package_json}" ]]; then
  echo "[runpod-worker] missing package.json at ${package_json}" >&2
  exit 1
fi

if [[ ! -f "${worker_script}" ]]; then
  echo "[runpod-worker] missing worker entrypoint at ${worker_script}" >&2
  exit 1
fi

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
echo "[runpod-worker] workspace=${workspace_dir} background_mode=${PARARIA_BACKGROUND_MODE:-external} audio_storage=${PARARIA_AUDIO_STORAGE_MODE:-blob} model=${FASTER_WHISPER_MODEL:-large-v3} batch=${FASTER_WHISPER_BATCH_SIZE:-8}"
auto_stop_idle_ms="${RUNPOD_WORKER_AUTO_STOP_IDLE_MS:-${LOCAL_GPU_WORKER_AUTO_STOP_IDLE_MS:-60000}}"
echo "[runpod-worker] auto_stop_idle_ms=${auto_stop_idle_ms}"

tsx_bin="${workspace_dir}/node_modules/.bin/tsx"
if [[ -x "${tsx_bin}" ]]; then
  echo "[runpod-worker] exec=tsx-direct"
  exec "${tsx_bin}" "${worker_script}"
fi

if command -v tsx >/dev/null 2>&1; then
  echo "[runpod-worker] exec=tsx-global"
  exec tsx "${worker_script}"
fi

echo "[runpod-worker] exec=npm-fallback"
exec npm --prefix "${workspace_dir}" run worker:runpod
