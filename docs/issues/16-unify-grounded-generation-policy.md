# ログ生成の考え方を 1 本にそろえる

## 状態

- 未着手
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

## 完了条件

- 通常生成、retry、fallback で思想がずれない
- artifact が plain data として扱いやすい
- 「盛る」方向の余地をさらに減らせる

## ラベル

- `backend`
- `ai`
- `quality`
- `priority:high`
