# 会話ログのジョブを、失敗や二重実行に強くする

## 状態

- 実装済み
- GitHub Issue: `#17`
- 最終更新: `2026-03-26`
- 最新補足: recoverable な `TRANSCRIBE_FILE` / `FINALIZE_LIVE_PART` / `PROMOTE_SESSION` 失敗は再キュー可能

## 何をするか

会話ログを作るバックグラウンドジョブを、次の問題に強くする。

- 同じジョブが二重に走る
- 失敗したまま止まる
- 何回 retry したかわからない
- どこで止まっているか追えない

## なぜやるか

利用が増えるほど、ジョブまわりの事故は起きやすくなる。

今のうちに土台を固めておかないと、

- ログができたりできなかったりする
- 原因調査に時間がかかる
- 運用でカバーするしかなくなる

という状態になる。

## やること

- job ごとの実行 ID を持たせる
- retry 回数を持たせる
- 最大 retry 回数を決める
- 次に retry する時刻を持たせる
- 開始時刻、完了時刻、失敗時刻を残す
- 長時間止まっている job を見つけられるようにする
- ログに `conversationId` などの追跡情報を出す

## 終わったといえる状態

- [x] 同じ conversation に対する二重実行を防ぎやすい
- [x] retry の回数と結果を追える
- [x] 止まっているジョブを見つけられる
- [x] 「どこで止まったか」を管理者が追いやすい

## 今回入れたもの

- `ConversationJob` に `executionId / maxAttempts / nextRetryAt / leaseExpiresAt / lastHeartbeatAt / failedAt / completedAt / lastRunDurationMs / lastQueueLagMs` を追加した
- stale な `RUNNING` job を回収して再実行できるようにした
- retryable error のときは backoff 付きで `QUEUED` に戻すようにした
- API から job の進行情報を見られるようにした
- session part 側でも recoverable な文字起こし失敗と session promotion 失敗を `生成を再開する` から復旧できるようにした

## 確認

- `npm run typecheck`
- `npm run test:session-progress`
- `npm run test:local-stt`
- `npm run build`

## ラベル

- `backend`
- `infra`
- `jobs`
- `priority:high`
