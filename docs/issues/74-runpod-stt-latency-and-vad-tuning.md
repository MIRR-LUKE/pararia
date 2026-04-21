# Runpod + faster-whisper の STT latency を VAD と計測で詰める

## 状態

- Closed
- GitHub Issue: `#152`
- 最終更新: `2026-04-18`

## 何をするか

Runpod worker の STT を、startup 待ちと transcription 本体を分けて計測できるようにしつつ、faster-whisper の VAD を env で明示的に調整できるようにする。

## なぜやるか

いまは queue 待ち、pod ready、worker 準備、transcribe、本体保存が 1 つの遅さとして見えてしまい、どこを詰めるべきか判断しづらい。

さらに VAD が既定値まかせだと、日本語の長い面談で切り方が安定せず、速度比較も再現しにくい。

## やること

- faster-whisper worker に VAD の env を追加する
- worker から `transcribe_elapsed_ms` と VAD 設定を返す
- app 側で `prepare / transcribe / finalize / worker` の STT 時間を保存する
- README と worker ドキュメントに推奨値と比較軸を書く

## 完了条件

- VAD の主要値を env で固定できる
- STT の遅さを phase ごとに見分けられる
- 運用手順に推奨値と計測コマンドが書かれている
