# Teacher App の mobile 録音 lifecycle を harden する

## 状態

- Open
- GitHub Issue: `#165`
- 最終更新: `2026-04-19`

## 目的

mobile app 化したときに一番壊れやすい **録音中の lifecycle** を固める。  
background / foreground、画面ロック、permission 変化、通信切断、再起動のときも、先生が戻れる導線を守る。

## 親 issue

- `#169` / `88` Teacher App を iOS / Android app として使える形に進める

## この issue でやること

- app の foreground / background 復帰時の state 復元を整理する
- 録音中に app が中断されたときの product behavior を明文化する
- permission denied / interrupted / recorder error の telemetry を足す
- pending upload queue と app 再起動復帰の相性を実機前提で見直す
- duplicate recorder / duplicate upload を防ぐガードを補強する
- iOS / Android の実機差分を吸収するための capability check を追加する

## ここで決めるべきこと

- background に入った録音を自動停止するのか
- 復帰時に `未送信一覧へ戻す` のか `録音失敗としてやり直し` にするのか
- permission が途中で剥がれた時の UI をどう見せるのか

## 完了条件

- 録音中の app 中断で状態が壊れにくい
- 失敗しても `再送` か `やり直し` のどちらかへ確実に戻せる
- telemetry で mobile 特有の failure が追える
- 実機 QA で再現した mobile 特有の落とし穴が main flow を壊さない
