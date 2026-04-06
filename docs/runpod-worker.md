# Runpod worker 運用

Pararia の本番 web は Vercel に置いたまま、STT だけ Runpod の GPU worker で回す構成です。

## いまの作りに合う形

いまの Pararia は、web 側が job を DB に積み、worker がそれを取りに行く作りです。
なので Runpod では **Serverless endpoint より Pod worker** のほうが自然です。
ただし 4090 を常駐させると高いので、運用は **on-demand 起動 + idle stop** を前提にします。

- Vercel: ログイン、録音、upload、job 登録
- Blob: 音声の共有保存
- Runpod Pod: `npm run worker:gpu` を必要時だけ起動
- OpenAI: 面談ログ / 指導報告ログの生成

## GitHub から使うもの

repo には次を入れています。

- `Dockerfile.runpod-worker`
- `scripts/runpod-worker-start.sh`
- `scripts/requirements.runpod-worker.txt`
- `.github/workflows/publish-runpod-worker.yml`

GitHub Actions が通ると、worker イメージを GHCR に出します。

- 画像名: `ghcr.io/<GitHub owner>/pararia-runpod-worker:latest`

## Runpod でやること

### 1. GitHub Actions でイメージを出す

GitHub の Actions で `Publish Runpod Worker Image` を実行します。

通ったら GHCR に `latest` と `sha-...` が出ます。

CLI で出したいときは、repo から次でも確認できます。

```bash
gh workflow run "Publish Runpod Worker Image" --ref main
gh run watch --workflow "Publish Runpod Worker Image"
```

### 2. Runpod で Pod を作る

Runpod の Pods で次を入れます。

- Container Image: `ghcr.io/<GitHub owner>/pararia-runpod-worker:latest`
- GPU: まずは `RTX 4090` か `RTX 5090`
- Container Disk: `30GB` 以上推奨
- Volume: 必須ではない
- Start Command: 空でよい
  - Dockerfile 側の `CMD` で worker を起動します

初回だけは Pod 定義が必要ですが、その後は stop / start を API で回せます。

### 3. Runpod に入れる env

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
- `FASTER_WHISPER_BATCH_SIZE=8`
- `FASTER_WHISPER_CHUNKING_ENABLED=0`
- `FASTER_WHISPER_POOL_SIZE=1`

GPU が強いときの最初の目安:

- RTX 4090: `FASTER_WHISPER_BATCH_SIZE=16`
- RTX 5090: `FASTER_WHISPER_BATCH_SIZE=24`

まずは 1 worker / chunking off のまま速さを見るのが安全です。

on-demand 推奨値:

- `LOCAL_GPU_WORKER_AUTO_STOP_IDLE_MS=300000`
  - queue が空のまま 5 分経ったら worker が自分で Pod を stop する

## 起動確認

Pod のログに次が出れば worker 自体は起動しています。

```text
[runpod-worker] starting
[local-gpu-worker] started
```

そのあと、Vercel 側で音声 upload をすると、Pod 側に次のようなログが出ます。

```text
[local-gpu-worker] tick
[conversation-jobs] job_started
[conversation-jobs] job_completed
```

## 詰まりやすい点

### Blob token がない

`BLOB_READ_WRITE_TOKEN` が入っていないと upload token 発行が失敗します。

### inline のままになっている

`PARARIA_BACKGROUND_MODE=external` が入っていないと、Vercel 側で job をその場実行しようとして詰まります。

### GHCR が private のまま

GHCR イメージが private のままだと、Runpod から pull できません。
その場合は次のどちらかです。

- package を public にする
- Runpod 側で GHCR pull 用の認証を入れる

## 参考

- Runpod は Pod-first の流れを案内しています
- Runpod docs: https://docs.runpod.io/serverless/development/dual-mode-worker

## API で Pod を作る / 起こす / 止める

repo には Runpod REST API 用のスクリプトも入れています。

- `scripts/runpod-deploy.ts`
- `scripts/runpod-manage.ts`
- `npm run runpod:deploy`
- `npm run runpod:start`
- `npm run runpod:status`
- `npm run runpod:stop`

必要な env:

- `RUNPOD_API_KEY`
- `DATABASE_URL`
- `DIRECT_URL`
- `BLOB_READ_WRITE_TOKEN`
- `OPENAI_API_KEY`

PowerShell に直接入れられないときは、repo ルートの `.env.local` に次を追記してください。
このスクリプトは `.env.local` → `.env` の順で自動読込します。

```bash
RUNPOD_API_KEY="your-runpod-api-key"
```

最小実行例:

```bash
npm run runpod:deploy -- --gpu="NVIDIA GeForce RTX 4090" --name="pararia-gpu-worker"
```

既存 Pod を起こす / なければ作る:

```bash
npm run runpod:start -- --wait
```

状態確認:

```bash
npm run runpod:status
```

止める:

```bash
npm run runpod:stop
```

主な引数:

- `--gpu=...`
- `--name=...`
- `--image=ghcr.io/mirr-luke/pararia-runpod-worker:latest`
- `--secure-cloud=true`
- `--container-disk=30`
- `--volume=0`
- `--gpu-count=1`

`runpod:deploy` は Pod を 1 台新規作成して worker 用 env をまとめて入れます。
`runpod:start` は同名 Pod があれば start、なければ create します。
`runpod:stop` は同名 Pod を止めます。

## 本番 web から自動 wake したいとき

upload / regenerate の enqueue 時に Pod を自動 wake するコードは repo に入れています。
ただしそれを **Pararia 本番** で使うには、Vercel 側の server env にも `RUNPOD_API_KEY` が必要です。

- local だけ `RUNPOD_API_KEY` がある
  - この端末から `npm run runpod:start` はできる
  - 本番 web からの自動 wake はまだできない
- Vercel にも `RUNPOD_API_KEY` がある
  - 本番 web の upload / regenerate から自動 wake できる
