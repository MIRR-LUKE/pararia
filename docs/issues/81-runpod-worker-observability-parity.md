# Runpod worker 計測を本番一致にする: STT subphase null をなくし image / revision を毎回残す

## 状態

- Open
- GitHub Issue: `#158`
- 最終更新: `2026-04-18`

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

## 完了条件

- production 相当の 3 run で `sttPrepareMs / sttTranscribeMs / sttTranscribeWorkerMs / sttFinalizeMs / sttVadParameters` がすべて non-null
- summary の `Worker p50` が実値で出る
- 各 JSON から `worker image` と `runtime revision` を一意に追える

## 参考

- Runpod worker deploy / image versioning: https://docs.runpod.io/serverless/workers/deploy
- Runpod environment variables: https://docs.runpod.io/serverless/development/environment-variables
- Runpod Pod update API: https://docs.runpod.io/api-reference/pods/POST/pods/podId/update
