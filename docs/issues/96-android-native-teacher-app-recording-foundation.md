# Android native Teacher App の録音基盤と最小 UI を作る

## 状態

- Open
- GitHub Issue: `#170`
- 最終更新: `2026-04-21`

## 目的

Android 端末で、Teacher 録音導線を **完全ネイティブ**で通せるようにする。  
MVP では、校舎端末で `待機 -> 録音 -> 解析中 -> 生徒確認 -> 完了 -> 未送信一覧` を迷わず回せることを優先する。

## 親 issue

- `#171` / `93` Teacher 録音 app を完全ネイティブ前提で作り直す全体計画

## 方針

- UI は Jetpack Compose を基本にする
- 録音は Android の録音 API と microphone foreground service 前提で設計する
- 録音ファイルは app private storage に保存する
- upload queue は process death や app 再起動から復元できる形にする

## この issue でやること

- Android app の project foundation を作る
- 校舎共通端末 login / bootstrap を native で通す
- 待機画面、録音中画面、解析中画面、生徒確認画面、完了画面、未送信一覧を仮 UI で作る
- standby からの音声アップロードを native で通す
- 録音中の一時停止 / 再開 / キャンセル二重確認を入れる
- microphone permission と denied state を native UI で扱う
- local recording, local file retention, retryable upload queue を入れる
- backend から student candidates を受けて確定できるようにする

## 2026-04-21 までに repo へ入ったもの

- `createRecording -> MediaRecorder.start` の途中失敗時に server recording を best-effort cancel するようにした
- pending upload に `duration / attemptCount / lastAttemptAt` を持たせた
- retry queue は 1 件失敗しても残りを続け、最後に最初の error を返すようにした
- upload success 後に local audio file を削除するようにした
- `401` retry が local expiry 判定だけで詰まらないよう `forceRefresh` 経路を入れた
- foreground service 起動を `ServiceCompat.startForeground(..., FOREGROUND_SERVICE_TYPE_MICROPHONE)` へ寄せた
- JVM test harness 用 dependency を build script に追加した

## 注意

- admin 機能は app に入れない
- Android の background start 制約を回避するのではなく、録音開始条件を product 仕様に合わせる
- 録音中 interrupt、foreground service、process death の hardening は `#165` で詰める

## 完了条件

- Android 実機で端末ログインから生徒確認まで main flow が通る
- Android 実機で `録音 -> 一時停止 -> 再開 -> 停止` と `音声アップロード` の両方が通る
- 録音ファイルが local に保持され、upload failure 後に再送できる
- permission denied / microphone unavailable で先生が詰まりにくい
- backend 契約に沿って session / recording / confirm が通る
- STT 完了後に Runpod pod が `stopped` へ戻ることを実機 QA で確認している
