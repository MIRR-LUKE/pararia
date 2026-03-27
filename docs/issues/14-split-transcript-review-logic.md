# 固有名詞レビューのロジックを小さく分けて読みやすくする

## 状態

- 未着手
- GitHub Issue: `#27`
- 最終更新: `2026-03-27`

## 何をするか

`lib/transcript/review.ts` に集まっている責務を分けて、読みやすく直しやすい形にする。

## なぜやるか

いまの review 周りは機能としては動いていますが、

- 候補抽出
- 類似度計算
- review 必要判定
- reviewedText の再構築
- DB 同期
- API 向け整形

が 1 ファイルに寄っています。

このままだと、変更時の影響が読みにくく、テストも書きづらいです。

## やること

- `lib/transcript/glossary.ts` に辞書読み込みと candidate 組み立てを寄せる
- `lib/transcript/suggestion.ts` に token span 抽出、similarity 計算、suggestion draft 作成を寄せる
- `lib/transcript/review-assessment.ts` に reviewRequired と理由判定を寄せる
- `lib/transcript/reviewed-text.ts` に suggestion 適用と reviewedText 生成を寄せる
- `lib/transcript/review-service.ts` に DB 同期と orchestration を寄せる

## 完了条件

- 1 ファイル 1 責務に近づいている
- suggestion ロジックだけ、review 判定だけ、DB 同期だけを個別に読める
- テストを小さく分けて書きやすい

## ラベル

- `backend`
- `refactor`
- `priority:high`
