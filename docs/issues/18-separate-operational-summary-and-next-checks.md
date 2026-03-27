# 運用ログ向けの要約を、報告用アクションと分けて整理する

## 状態

- 実装済み
- GitHub Issue: `#31`
- 最終更新: `2026-03-27`

## 何をするか

`operational-log.ts` で扱う「今回の判断」と「次回確認事項」を分けて、意味が潰れないようにする。

## なぜやるか

いまは `artifact.nextActions` が assessment と nextChecks の両方に流れやすく、意味が少し混ざっています。

このままだと、

- 今回わかったこと
- 次に確認すること
- 他の人に共有したいこと

の区別が下流で見えにくくなります。

## やること

- artifact 側で `今回の判断`、`次回確認`、`共有事項` を分けて持てるようにする
- もしくは renderer 側で意味を崩さず切り分ける
- `operational-log.ts` で同じ配列を流用しない
- Student Room と report bundle に流すときの意味をそろえる

## 今回入れた内容

- `ConversationArtifactEntry` に `actionType` を持たせた
- `nextActions` から `assessment` と `nextCheck` を分けて読むようにした
- `assessment` と `nextChecks` を top-level でも別々に持てるようにした
- `operational-log` は同じ配列を二重流用せず、別の一覧として出すようにした
- render / parse でも `判断:` と `次回確認:` を扱えるようにした

## 確認

- `npm run typecheck`
- `npx tsx scripts/test-conversation-artifact-semantics.ts`
- `npm run test:log-render-and-llm-retries`
- `npm run build`

## 完了条件

- assessment と nextChecks の意味が分かれる
- bundle preview の情報が自然になる
- 下流画面で説明しやすいデータになる

## ラベル

- `backend`
- `product`
- `priority:medium`
