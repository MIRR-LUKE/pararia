# ログ生成の考え方を 1 本にそろえる

## 状態

- 実装済み
- GitHub Issue: `#29`
- 最終更新: `2026-03-27`

## 何をするか

`spec.ts`、`generate.ts`、`fallback.ts` の考え方をそろえて、「うまい文章」より「根拠があるログ」を一貫して優先する。

## なぜやるか

いまの main はかなり良い方向ですが、retry prompt など一部にはまだ rewrite-heavy な色が残っています。

このままだと、

- 通常生成と retry で思想がずれる
- fallback だけ別ルールで動いて見える
- 「盛らない」がコード全体で 1 本になりきらない

という状態になります。

## やること

- retry prompt から rewrite-heavy な文を外す
- `spec.ts` のルールを single source にして retry でも同じ考え方を使う
- fallback は今の保守的な方向を維持しつつ、`確認不足` と `要再確認` の扱いを明確にする
- claim の `observed / inferred / missing` を renderer や downstream でも活かす
- `ConversationArtifactEntry` からメソッドっぽい持ち方を減らして plain data に寄せる

## 今回入れた内容

- system prompt を `指示:` と `文脈:` に分け、先にルールを置く形へ整理した
- retry prompt は `spec.ts` の共通 prompt body を使う形に寄せて、通常生成と別思想にならないようにした
- 通常生成は JSON で `structured artifact` を先に作り、markdown はそこから render する形へ寄せた
- deterministic recovery は「JSON が壊れた」「出力が弱すぎる」ときの最後の保険だけにした
- claim は `観察 / 推測 / 不足`、action は `判断 / 次回確認` で扱えるようにした
- artifact は `claimType / actionType` を持つ plain data に寄せ、parse でも後から破壊的に補完しない形へ整理した
- fallback も同じラベルで保守的に出すようにした

## 確認

- `npm run typecheck`
- `npm run test:conversation-draft-quality`
- `npx tsx scripts/test-conversation-artifact-semantics.ts`
- `npm run test:log-render-and-llm-retries`
- `npm run test:conversation-eval -- --out .tmp/conversation-eval-report.md`
- `npm run build`

## 完了条件

- 通常生成、retry、fallback で思想がずれない
- artifact が plain data として扱いやすい
- 「盛る」方向の余地をさらに減らせる

## ラベル

- `backend`
- `ai`
- `quality`
- `priority:high`
