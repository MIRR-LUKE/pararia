# backend/perf ブランチで UI 変更を止める path guard を入れる

## 状態

- Open
- GitHub Issue: `#81`
- 最終更新: `2026-04-14`

## 何をするか

backend / perf 系ブランチでは `app/app/**`, `components/**`, `*.module.css` などの UI 変更を CI で禁止し、勝手な見た目変更を main に混ぜないようにする。

## なぜやるか

今回のように backend 改善のつもりで UI が触られると、ユーザー体験の差分確認とログ生成のデバッグが同時に発生してコストが大きい。

## やること

- branch 名と変更 path を見て backend-only 対象か判定する script を追加する
- GitHub Actions で backend/perf ブランチ時に guard を実行する
- 許可する変更 path と禁止する変更 path を docs に書く
- 例外が必要な場合は branch 名や env で明示する

## 完了条件

- backend/perf ブランチで UI を触ると CI が落ちる
- どの path が禁止対象か docs から分かる
- 高速化と UI 改修の PR が自然に分離される

## ラベル

- `tooling`
- `quality`
- `architecture`
- `priority:high`
