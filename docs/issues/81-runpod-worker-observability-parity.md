# Runpod worker 計測を本番一致にする: STT subphase null をなくし image / revision を毎回残す

## 状態

- Closed
- GitHub Issue: `#158`
- 最終更新: `2026-04-25`

## 何をするか

本番相当 Runpod UX 計測で、どの worker image / runtime revision / feature flag で走ったかを毎回特定できるようにし、STT subphase と VAD 指標が `null` になる状態をなくす。

## なぜやるか

2026-04-18 の `runpod:measure-ux` 3 run では、次が 3/3 で `null` だった。

- `sttPrepareMs`
- `sttTranscribeMs`
- `sttTranscribeWorkerMs`
- `sttFinalizeMs`
- `sttVadParameters`

一方で、ローカルコードでは `lib/jobs/session-part-jobs/transcribe-file.ts` がこれらを `qualityMeta` に保存している。`scripts/runpod-measure-ux.ts` 側も同じフィールドを読みに行っている。

つまり、観測経路か実際に動いている worker image / revision のどちらかが、現行コードと一致していない可能性が高い。

加えて、手元の Runpod env では `RUNPOD_WORKER_IMAGE` は SHA pin されているが、計測結果自体には runtime revision が残らない。これでは「どの image がこの結果を出したか」を後から厳密に言えない。

Runpod 公式 docs でも、本番は mutable な `latest` ではなく SHA 付き image を使い、どの image/SHA を使ったかを文書化することが推奨されている。

## やること

- worker 起動時に `worker image / git sha / runtime revision / feature flags` を self-report する
- `session part qualityMeta` と `runpod:measure-ux` JSON に上の revision 情報を残す
- `runpod:measure-summary` で required metric が `null` のとき `0ms` 扱いせず warning にする
- deploy / smoke で「deployed worker が STT subphase を実際に返す」ことを確認する
- README と Runpod worker docs に version handshake と required env を書く

## 2026-04-19 進捗

- worker heartbeat (`startup.json` / `db-ok.json`) に `runpodWorkerImage / runpodWorkerGitSha / runpodWorkerRuntimeRevision / runpodWorkerFeatureFlags` を残すようにした
- session part `qualityMetaJson` と `runpod:measure-ux` JSON に同じ runtime metadata を残すようにした
- `runpod:measure-summary` は missing STT subphase を warning として出すようにした
- `buildRunpodWorkerEnv` 側で image / git sha / runtime revision を env に注入する回帰テストを足した

## 2026-04-25 production 相当 3090 実測

- 条件: `--profile 3090 --startup-mode direct`
- worker image: `ghcr.io/mirr-luke/pararia-runpod-worker:sha-853fba84c3fb673645f348dac594d96b8d303040`
- runtime revision: `git-853fba84c3fb673645f348dac594d96b8d303040`
- `sttPrepareMs`: `1274 / 1544 / 1503`
- `sttTranscribeWorkerMs`: `29189 / 26973 / 27193`
- `sttFinalizeMs`: `29279 / 27047 / 27295`
- `sttVadParameters`: 3/3 non-null
- summary の `Worker p50`: `27193ms`

STT subphase と runtime metadata が production 相当 3 run ですべて埋まったため close。

## 完了条件

- production 相当の 3 run で `sttPrepareMs / sttTranscribeMs / sttTranscribeWorkerMs / sttFinalizeMs / sttVadParameters` がすべて non-null
- summary の `Worker p50` が実値で出る
- 各 JSON から `worker image` と `runtime revision` を一意に追える

## 参考

- Runpod worker deploy / image versioning: https://docs.runpod.io/serverless/workers/deploy
- Runpod environment variables: https://docs.runpod.io/serverless/development/environment-variables
- Runpod Pod update API: https://docs.runpod.io/api-reference/pods/POST/pods/podId/update
