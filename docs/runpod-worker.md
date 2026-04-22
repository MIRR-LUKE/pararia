# Runpod worker 運用

Pararia の STT 主導線は `web -> queue -> Runpod worker -> LLM finalize` です。
`localhost` でも `Vercel production` でも、web 側は同じ contract を使い、Runpod 側が STT と後段ジョブを処理します。
deploy 後に production の録音主導線を 1 本だけ確認するときは、GitHub Actions `Production Recording Smoke` を正本 smoke にします。手動再確認は `npm run test:recording-ui -- --base-url https://pararia.vercel.app --env-file .tmp/.env.production.runpod --skip-navigation-dialog --require-runpod-stop --expect-completion-state success --expect-observed-states uploading,processing,success` を使います。
workflow を自動で回すには、GitHub Secrets に `SUPABASE_DB_URL`, `BLOB_READ_WRITE_TOKEN`, `PRODUCTION_INTEGRITY_AUDIT_EMAIL`, `PRODUCTION_INTEGRITY_AUDIT_PASSWORD`, `RUNPOD_API_KEY` が必要です。

## いまの前提

- web 側は job を DB に積み、必要なら Runpod Pod を自動 wake する
- 音声 upload / live chunk は `Vercel Blob` に置き、web と Runpod worker から同じ参照を読む
- Runpod worker は `faster-whisper` で STT し、そのまま `FINALIZE` / `FORMAT` まで進める
- 4090 を常駐させず、**on-demand 起動 + idle stop** を前提にする

## repo に入っているもの

- `Dockerfile.runpod-worker`
- `scripts/run-runpod-worker.ts`
- `scripts/runpod-worker-start.sh`
- `scripts/requirements.runpod-worker.txt`
- `.github/workflows/publish-runpod-worker.yml`
- `scripts/runpod-deploy.ts`
- `scripts/runpod-manage.ts`

## web 側で必要な env

- `PARARIA_BACKGROUND_MODE=external`
- `PARARIA_AUDIO_STORAGE_MODE=blob`
- `PARARIA_AUDIO_BLOB_ACCESS=private`
- `NEXT_PUBLIC_AUDIO_STORAGE_MODE=blob`
- `BLOB_READ_WRITE_TOKEN`

本番 web から自動 wake したいときは、さらに:

- `RUNPOD_API_KEY`
- `RUNPOD_WORKER_GPU_CANDIDATES` 例: `NVIDIA GeForce RTX 5090,NVIDIA GeForce RTX 4090`

## Runpod Pod に入れる env

必須:

- `DATABASE_URL`
- `DIRECT_URL`
- `BLOB_READ_WRITE_TOKEN`
- `OPENAI_API_KEY`
- `PARARIA_BACKGROUND_MODE=external`
- `PARARIA_AUDIO_STORAGE_MODE=blob`
- `PARARIA_AUDIO_BLOB_ACCESS=private`

STT 推奨値:

- `FASTER_WHISPER_MODEL=large-v3`
- `FASTER_WHISPER_REQUIRE_CUDA=1`
- `FASTER_WHISPER_DEVICE=auto`
- `FASTER_WHISPER_COMPUTE_TYPE=auto`
- `FASTER_WHISPER_BEAM_SIZE=1`
- `FASTER_WHISPER_BATCH_SIZE=16`
- `FASTER_WHISPER_VAD_MIN_SILENCE_MS=1000`
- `FASTER_WHISPER_VAD_SPEECH_PAD_MS=400`
- `FASTER_WHISPER_VAD_THRESHOLD=0.5`
- `FASTER_WHISPER_CHUNKING_ENABLED=0`
- `FASTER_WHISPER_POOL_SIZE=1`

worker loop 調整:

- `RUNPOD_WORKER_SESSION_PART_LIMIT=8`
- `RUNPOD_WORKER_SESSION_PART_CONCURRENCY=1`
- `RUNPOD_WORKER_CONVERSATION_LIMIT=6`
- `RUNPOD_WORKER_CONVERSATION_CONCURRENCY=1`
- `RUNPOD_WORKER_IDLE_WAIT_MS=2500`
- `RUNPOD_WORKER_ACTIVE_WAIT_MS=200`
- `RUNPOD_WORKER_AUTO_STOP_IDLE_MS=60000`
- `RUNPOD_WORKER_ONLY_SESSION_ID=...`
- `RUNPOD_WORKER_ONLY_CONVERSATION_ID=...`
- `RUNPOD_WORKER_RUNTIME_REVISION=...`

version handshake 用:

- `RUNPOD_WORKER_IMAGE`
- `RUNPOD_WORKER_GIT_SHA`
- `RUNPOD_WORKER_RUNTIME_REVISION`

速度優先の補足:

- 1 本最速を狙うときは `FASTER_WHISPER_BEAM_SIZE=1` を基本にする
- VAD は `min_silence_duration_ms=1000` を基準にし、必要なら `500 / 1000 / 2000` を比較する
- `compute_type=auto` のままでよいが、worker image は `CTranslate2 4.7.1 + CUDA 12.8` 前提にする
- `RTX 4090` など pre-Blackwell では `int8_float16` 系を優先する
- `RTX 5090` など Blackwell では `float16` 系を優先する
- benchmark 専用に 1 session だけ処理したいときは `RUNPOD_WORKER_ONLY_SESSION_ID` を使う
- STT だけ見たいときは `RUNPOD_WORKER_CONVERSATION_LIMIT=0` で conversation job を止められる
- `npm run runpod:measure-summary -- --dir .tmp/runpod-ux --out .tmp/runpod-ux-summary.md` で p50 / p95 を見られる

## GHCR へ worker image を publish

GitHub Actions の `Publish Runpod Worker Image` を実行します。

```bash
gh workflow run "Publish Runpod Worker Image" --ref main
gh run watch --workflow "Publish Runpod Worker Image"
```

成功すると GHCR に次が出ます。

- `ghcr.io/<GitHub owner>/pararia-runpod-worker:latest`
- `ghcr.io/<GitHub owner>/pararia-runpod-worker:sha-...`

切り分けや本番固定では `latest` ではなく `sha-...` を使います。

## Pod を API で作る / 起こす / 止める

PowerShell へ直接 env を入れづらいときは、repo ルートの `.env.local` に次を入れます。

```bash
RUNPOD_API_KEY="your-runpod-api-key"
```

新規作成:

```bash
npm run runpod:deploy -- --gpu="NVIDIA GeForce RTX 4090" --name="pararia-gpu-worker"
```

既存 Pod を起こす / なければ作る:

```bash
npm run runpod:start -- --wait
```

fresh image で必ず作り直す:

```bash
npm run runpod:start -- --fresh --wait
```

SHA 固定 image を使う例:

```bash
npm run runpod:start -- --fresh --wait --image=ghcr.io/<GitHub owner>/pararia-runpod-worker:sha-<commit>
```

private GHCR image のときは、Runpod の container registry auth を作り、
`RUNPOD_WORKER_CONTAINER_REGISTRY_AUTH_ID` または `--registry-auth-id=...` を使う。

状態確認:

```bash
npm run runpod:status
```

停止:

```bash
npm run runpod:stop
```

完全に消す:

```bash
npm run runpod:terminate
```

主な引数:

- `--gpu=...`
- `--name=...`
- `--image=ghcr.io/mirr-luke/pararia-runpod-worker:latest`
- `--secure-cloud=true`
- `--container-disk=30`
- `--volume=0`
- `--gpu-count=1`

## 起動確認

`npm run runpod:start -- --wait` は、Pod が `RUNNING` になるだけでなく、
worker が `runpod-worker/heartbeats/<podId>/db-ok.json` を書くまで待ちます。

Pod のログに次が出れば worker loop は起動しています。

```text
[runpod-worker] starting
[runpod-worker] started
```

upload / regenerate が入ると、次のようなログが出ます。

```text
[runpod-worker] tick
[conversation-jobs] job_started
[conversation-jobs] job_completed
```

heartbeat の `startup.json` / `db-ok.json` には次も残る:

- `runpodWorkerImage`
- `runpodWorkerGitSha`
- `runpodWorkerRuntimeRevision`
- `runpodWorkerFeatureFlags`

`runpod:measure-ux` と session part `qualityMetaJson` にも同じ runtime 情報を残すので、あとから「どの image / revision がこの結果を出したか」を追える。

## よく詰まる点

### `PARARIA_AUDIO_STORAGE_MODE=blob` になっていない

`external` なのに `local` 保存だと Runpod worker が音声を読めません。
現行コードではこの組み合わせを route で reject します。

### `BLOB_READ_WRITE_TOKEN` がない

upload token 発行や worker 側の読み出しが失敗します。

### `RUNPOD_API_KEY` が web 側にない

ローカル端末から `npm run runpod:start` はできますが、upload 時の自動 wake はできません。

### GHCR image が pull できない

GHCR package が private のままなら、Runpod から pull できる公開設定か認証が必要です。

## 参考

- Runpod docs: https://docs.runpod.io/serverless/development/dual-mode-worker
