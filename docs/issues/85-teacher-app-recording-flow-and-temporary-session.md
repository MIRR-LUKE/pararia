# Teacher App の録音主導線を作る: 待機 / 録音中 / 解析中 / temporary session

## 状態

- Closed
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

## 進捗メモ

- 完了:
  - 待機画面から 1 tap で録音開始し、録音終了または中止まで進める MediaRecorder 導線が入った
  - 録音開始時に `TeacherRecordingSession` を作り、temporary recording 単位で backend に受け渡せるようになった
  - 録音停止後は音声を upload し、`TeacherRecordingJob` で STT と生徒候補抽出を進める流れがつながった
  - 解析中画面は progress polling で更新し、inline / external worker の両方で処理継続できる
  - `TRANSCRIBING` / `AWAITING_STUDENT_CONFIRMATION` の録音は、同じ端末から再読み込みしても復元できる
  - 短すぎる録音、録音開始失敗、upload failure では待機画面へ戻す最小ハンドリングを入れた
  - temporary recording の参照は device scope で閉じ、別端末の in-flight recording を拾わないようにした
- この issue の外に残っていること:
  - 生徒確定後に正式 `Session / SessionPart / Conversation` を作って本ログ生成へ渡す処理は `#162`
  - 未送信 queue への退避と再送は `#163`
