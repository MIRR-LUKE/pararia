# Runpod worker 運用

Pararia の本番 web は Vercel に置いたまま、STT だけ Runpod の GPU worker で回す構成です。

## いまの作りに合う形

いまの Pararia は、web 側が job を DB に積み、worker がそれを取りに行く作りです。
なので Runpod では **Serverless endpoint より、常駐 Pod** のほうが自然です。

- Vercel: ログイン、録音、upload、job 登録
- Blob: 音声の共有保存
- Runpod Pod: `npm run worker:gpu` を常駐
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

### 2. Runpod で Pod を作る

Runpod の Pods で次を入れます。

- Container Image: `ghcr.io/<GitHub owner>/pararia-runpod-worker:latest`
- GPU: まずは `RTX 4090` か `RTX 5090`
- Container Disk: `30GB` 以上推奨
- Volume: 必須ではない
- Start Command: 空でよい
  - Dockerfile 側の `CMD` で worker を起動します

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
