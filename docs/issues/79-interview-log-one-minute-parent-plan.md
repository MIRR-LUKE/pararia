# 面談ログ生成を本番で 1 分台に近づける親 Issue を前に進める

## 状態

- Closed
- GitHub Issue: `#151`
- 最終更新: `2026-04-25`

## 何をするか

本番の面談ログ生成を、品質を落とさず 1 分台に近づけるための親 Issue として、baseline、子 Issue、測定方法、残りの完了条件を 1 か所にまとめる。

## baseline

- 2026-04-17 の本番マイク録音フロー:
  - 録音開始まで `856ms`
  - 録音停止可能になるまで `92.5秒`
  - 停止後に成功表示まで `130.9秒`
  - 合計 `163.8秒`
- 同日の裏側計測では、OpenAI の面談ログ生成そのものは約 `11.7秒`
- つまり主ボトルネックは `STT / Runpod 起動待ち / 進捗制御` にある

## 2026-04-18 時点で完了した子 Issue

- `#152` Runpod + faster-whisper の STT latency を VAD と phase 計測で詰める
- `#153` progress / log polling を read-only に寄せ、手入力 transcript を one-shot で進める
- `#154` ログ生成 retry と next meeting memo を prompt cache 前提で安定させる
- `#155` duplicate enqueue でも active job と last good artifact を壊さない
- `#156` Runpod UX 計測を p50 / p95 / cost までまとめて見えるようにする

関連 docs:

- [74-runpod-stt-latency-and-vad-tuning.md](./74-runpod-stt-latency-and-vad-tuning.md)
- [75-progress-readonly-polling-and-manual-transcript-start.md](./75-progress-readonly-polling-and-manual-transcript-start.md)
- [76-stable-prompt-cache-and-memo-roundtrip.md](./76-stable-prompt-cache-and-memo-roundtrip.md)
- [77-preserve-active-jobs-and-last-good-artifacts.md](./77-preserve-active-jobs-and-last-good-artifacts.md)
- [78-runpod-ux-percentiles-and-cost-summary.md](./78-runpod-ux-percentiles-and-cost-summary.md)

## いま見えること

- LLM 自体は本番でも 10 秒台で、主経路の支配項ではない
- 親 Issue に必要だった計測基盤は、子 Issue 側で `STT subphase / worker ready / queue-to-STT / queue-to-conversation / cache / cost` まで取れるようになった
- つまり、残っているのは主に「production 相当条件で 3 回連続で測って、結果を残す」こと

## 3 回連続計測のやり方

Runpod / STT の内訳:

```bash
npm run runpod:measure-ux -- --profile 3090 --startup-mode direct --out-dir .tmp/runpod-ux
npm run runpod:measure-summary -- --dir .tmp/runpod-ux --out .tmp/runpod-ux-summary.md
```

アプリ全体の生成導線:

```bash
PARARIA_ALLOW_REMOTE_GENERATION_SMOKE=1 npm run test:remote-generation-smoke -- --base-url https://pararia.vercel.app
```

ローカル長尺ベンチの参照:

- `docs/interview-benchmarks/*.json`
- `docs/stt-benchmarks/*.json`

## 2026-04-18 実測結果履歴

条件:

- `npm run runpod:measure-ux -- --profile 5090 --startup-mode reuse`
- 3 run
- source audio: `01-30 面談_ 受験戦略とルール運用（時間配分・見直し・難問後回し.mp3`

結果:

- Queue->Conversation:
  - run1: `152.0秒`
  - run2: `125.2秒`
  - run3: `145.1秒`
- 集計:
  - `p50`: `145.1秒`
  - `p95`: `152.0秒`
  - `pod ready p50/p95`: `15.8秒 / 17.3秒`
  - `queue->STT p50/p95`: `51.6秒 / 56.0秒`
  - `finalize p50`: `16.2秒`
  - `cost p50`: `$0.0476`

baseline `163.8秒` との差分:

- `p50 -18.7秒`
- `p95 -11.8秒`
- best run `-38.6秒`

## close 条件

- production 相当の 3 回連続計測が安定する
- 各 run の内訳が `runpod:measure-summary` か issue コメントで残る
- baseline `163.8秒` からの短縮量が README か issue コメントに残る

2026-04-18 時点で、上の条件は満たしたため parent issue `#151` は close する。
