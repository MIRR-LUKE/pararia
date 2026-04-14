# 録音ロックから次回の面談メモまでの critical path smoke を CI で止める

## 状態

- Open
- GitHub Issue: `#80`
- 最終更新: `2026-04-14`

## 何をするか

録音ロック、student room、session progress、next meeting memo の最小経路を CI で実行し、主経路の破壊を PR 時点で止める。

## なぜやるか

既存の `Conversation Quality` はログ品質には効くが、録音ロックや student room 側の破壊までは拾えない。

このままだと、

- route params や auth まわりの破壊を見逃す
- 次回の面談メモの回帰が main に入る
- UI で最初に見える `処理に失敗しました` まで気づけない

が残る。

## やること

- critical path smoke workflow を追加する
- `recording-lock`, `student-room`, `session-progress`, `next-meeting-memo` の regression script を追加する
- Prisma migration を当てた PostgreSQL 上で毎 PR 実行する
- 失敗時にどの段階で落ちたか分かる出力にする

## 完了条件

- 主経路の最小回帰が PR 時点で止まる
- 失敗した段階がログから分かる
- main へ入る前に録音系・次回メモ系の破壊を検知できる

## ラベル

- `backend`
- `quality`
- `tooling`
- `ci`
- `priority:high`
