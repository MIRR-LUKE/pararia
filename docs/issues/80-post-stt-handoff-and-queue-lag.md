# STT 後の空白時間を潰す: promotion から finalize 開始までの handoff / queue lag を分解して短くする

## 状態

- Closed
- GitHub Issue: `#159`
- 最終更新: `2026-04-25`

## 何をするか

Runpod 側で STT が終わってから conversation finalize が実際に走り始めるまでの空白時間を、handoff / queue lag / review / finalize に分解して観測し、そのうえで主因を削る。

## なぜやるか

2026-04-18 の `runpod:measure-ux` 3 run では、`Queue->Conversation` は `152.0秒 / 125.2秒 / 145.1秒`、`Queue->STT` は `56.0秒 / 41.7秒 / 51.6秒`、`finalize duration` は `17.8秒 / 16.2秒 / 15.0秒` だった。

つまり STT 完了後にも `96.0秒 / 83.5秒 / 93.5秒` の待ちが残っている。さらに `finalize queue lag + finalize duration` を引いても、未説明の待ちは `55.9秒 / 47.6秒 / 56.0秒` 残る。

ローカルコードでも、Runpod worker 上の promotion 完了時点では app 側 conversation job を直接 kick できない形になっている。

- `lib/jobs/session-part-jobs/promote-session.ts`
  - `kickPromotedConversationJobsOutsideRunpod()` は `RUNPOD_POD_ID` があると `false` を返す
- `app/api/sessions/[id]/progress/route.ts`
  - app 側の progress polling で `kickConversationJobsOutsideRunpod()` を後から呼ぶ
- `lib/jobs/conversation-jobs/app-dispatch.ts`
  - `requireRunpodStopped=true` のとき、Runpod worker stop を待ってから conversation job を始める

この形だと、`promotion -> app handoff -> queue claim -> review -> finalize start` のどこか、または複数で大きな待ちが埋もれる。

## やること

- `promotionCompletedAt`
- `conversationKickRequestedAt`
- `conversationJobClaimedAt`
- `reviewStartedAt`
- `reviewCompletedAt`
- `finalizeStartedAt`
- `finalizeCompletedAt`

を conversation / job meta と `runpod:measure-ux` JSON に残す。

- Runpod worker から app 側へ、poll 依存ではない明示 handoff を入れる
  - まずは `GET /api/sessions/[id]/progress` の `runAfterResponse` でも background dispatch を継続し、`POST` 待ちの hidden wait を減らす
- `requireRunpodStopped` の待ちを別フェーズとして観測し、必要なら handoff と stop を分離する
- `runpod:measure-summary` に post-STT breakdown を出す
- `session-progress` 側でも hidden wait を見えるようにする

## 2026-04-19 進捗

- `promote-session.ts` で `promotionCompletedAt / conversationDispatchMode / conversationEnsureState / conversationKickDeferredAt` を `qualityMetaJson.finalizeJob` に残すようにした
- `app-dispatch.ts` で `conversationKickRequestedAt / conversationAppDispatchStartedAt / conversationAppDispatchBlockedAt / conversationAppDispatchCompletedAt` を残すようにした
- `handlers.ts` で `conversationJobClaimedAt / reviewStartedAt / reviewCompletedAt / finalizeStartedAt / finalizeCompletedAt` を残すようにした
- `GET /api/sessions/[id]/progress` でも、まだ pipeline が進行中なら `runAfterResponse()` で background dispatch を継続するようにした
- `runpod:measure-ux` は上の timestamp を JSON に残し、`runpod:measure-summary` は `## Post-STT breakdown` と missing timestamp warning を出すようにした

## 2026-04-25 production 相当 3090 実測

- 条件: `--profile 3090 --startup-mode direct`
- worker image: `ghcr.io/mirr-luke/pararia-runpod-worker:sha-853fba84c3fb673645f348dac594d96b8d303040`
- runtime revision: `git-853fba84c3fb673645f348dac594d96b8d303040`
- `Queue->Conversation p50/p95`: `65.7秒 / 137.5秒`
- `Queue->STT p50/p95`: `47.7秒 / 119.6秒`
- `post-STT total p50/p95`: `18.0秒 / 18.0秒`
- `post-STT unknown p50/p95`: `0ms / 0ms`
- breakdown は `STT->promotion / promotion->kick / kick->app dispatch / app dispatch->claim / review / finalize` まですべて non-null

完了条件の「remaining wait の全内訳が説明できる」を満たしたため close。

## 完了条件

- production 相当の 3 run で post-STT breakdown がすべて non-null になる
- `Queue->Conversation - Queue->STT - finalizeQueueLag - finalizeDuration` の p50 が `30秒` 以下になる、または remaining wait の全内訳が説明できる
- user poll がなくても conversation handoff が始まる経路がある

## 参考

- Runpod Benchmarking: https://docs.runpod.io/serverless/development/benchmarking
- Vercel Realtime updates guidance: https://vercel.com/kb/guide/publish-and-subscribe-to-realtime-data-on-vercel
