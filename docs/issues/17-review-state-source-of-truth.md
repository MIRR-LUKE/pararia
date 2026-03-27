# review 状態の正本を 1 つに決める

## 状態

- 実装済み
- GitHub Issue: `#30`
- 最終更新: `2026-03-27`

## 何をするか

`reviewState`、`qualityMetaJson.transcriptReview`、`ProperNounSuggestion.status` の役割を整理して、どれを見れば今の状態が分かるかを明確にする。

## なぜやるか

いまの状態管理は実用的ですが、少し重複があります。

このままだと、

- 今の正式な状態がどこにあるか迷う
- backend と frontend で見方がずれる
- 状態ずれのバグが起きやすい

という問題が残ります。

## やること

- 正式な現在状態は `reviewState` に固定する
- `qualityMetaJson.transcriptReview` は理由と件数の説明に限定する
- `ProperNounSuggestion.status` は各候補の状態だけに限定する
- docs とコメントで関係を明文化する
- `reviewState` の更新責務を service に集約する

## 完了条件

- どの状態を見るべきか迷わない
- backend も frontend も同じ解釈になる
- 状態ずれのバグを減らせる

## 今回入れた内容

- 現在状態は `reviewState` を正本として扱う前提に整理した
- `qualityMetaJson.transcriptReview` は理由と件数の説明だけを持つように寄せた
- generation quality meta から current state を表す重複項目を外した
- review 更新責務は review service に集約した
- review service と型定義に source of truth を示すコメントを追加した
- transcript review regression で `qualityMetaJson.transcriptReview` に `reviewState` を重ねて持たないことを確認するようにした

## 確認

- `npm run typecheck`
- `npm run test:transcript-review`

## ラベル

- `backend`
- `architecture`
- `priority:medium`
