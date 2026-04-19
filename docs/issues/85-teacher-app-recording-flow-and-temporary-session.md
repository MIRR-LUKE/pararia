# Teacher App の録音主導線を作る: 待機 / 録音中 / 解析中 / temporary session

## 状態

- Open
- GitHub Issue: `#160`
- 最終更新: `2026-04-19`

## フェーズ

- Phase 1

## 目的

先生が迷わず `録音開始 -> 録音終了` まで進める main flow を先に完成させる。録音前の生徒選択は入れず、録音データは temporary session として安全に backend へ渡す。

## 何をするか

- 待機画面 / 録音中画面 / 解析中画面の provisional UI を作る
- 端末内の録音保持、録音終了、upload 開始までを 1 つの flow にする
- 録音開始時に temporary session を作り、音声 part を紐づける
- upload failure / recording failure / cancel の扱いを main flow に組み込む
- 解析中画面では本ログ生成をせず、STT 初期処理と候補抽出準備までに留める

## 完了条件

- 先生が待機画面から 1 tap で録音開始できる
- 録音中画面では `録音中 / 経過時間 / 録音終了` 以外で迷わない
- 音声が端末内と backend の両方で壊れず扱える
- 録音終了後は temporary session 経由で解析中画面へ進む
- 生徒未確定の状態で本ログ生成が始まらない
