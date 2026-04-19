# Teacher App の mobile 録音 lifecycle を harden する

## 状態

- Open
- GitHub Issue: `#165`
- 最終更新: `2026-04-19`

## 目的

mobile app 化したときに一番壊れやすい **録音中の lifecycle** を固める。  
background / foreground、画面ロック、permission 変化、通信切断、再起動のときも、先生が戻れる導線を守る。

## 親 issue

- `#171` / `93` Teacher 録音 app を完全ネイティブ前提で作り直す全体計画

## この issue でやること

- iOS interrupt / route change / permission change の挙動を native 前提で整理する
- Android foreground service / process death / while-in-use 制約を native 前提で整理する
- app の foreground / background 復帰時の state 復元を整理する
- pending upload queue と app 再起動復帰の相性を実機前提で見直す
- duplicate recorder / duplicate upload を防ぐガードを補強する
- permission denied / interrupted / recorder error の telemetry を足す

## ここで決めるべきこと

- background に入った録音を自動停止するのか
- 復帰時に `未送信一覧へ戻す` のか `録音失敗としてやり直し` にするのか
- permission が途中で剥がれた時の UI をどう見せるのか
- phone call / alarm / audio route change をどう扱うのか

## 完了条件

- 録音中の app 中断で状態が壊れにくい
- 失敗しても `再送` か `やり直し` のどちらかへ確実に戻せる
- telemetry で mobile 特有の failure が追える
- 実機 QA で再現した mobile 特有の落とし穴が main flow を壊さない
