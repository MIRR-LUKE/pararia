# Android native Teacher App の録音基盤と最小 UI を作る

## 状態

- Closed
- GitHub Issue: `#170`
- 最終更新: `2026-04-25`

## 目的

Android 端末で、Teacher 録音導線を **完全ネイティブ**で通せるようにする。  
MVP では、校舎端末で `待機 -> 録音 -> 解析中 -> 生徒確認 -> 完了 -> 未送信一覧` を迷わず回せることを優先する。

## 親 issue

- `#191` / `101` Android Teacher App を現場投入できるところまで仕上げる

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

## 2026-04-25 までに repo へ入ったもの

- Android app に `TeacherDiagnostics` と logcat tag `ParariaTeacherDiag` を追加した
- error / pending screen に調査メモとコピー導線を追加した
- pending item に attempt count を表示した
- 実機 A142 で debug APK install / launch / session restore / standby 表示まで確認した
- standby 画面が横向き時に録音ボタンを画面外へ押し出すため、`MainActivity` を portrait 固定にした
- Android audio mode が通話 / 通信中のとき、server recording を作る前に録音開始を止める guard を追加した
- `assembleDebug` と `:app:compileDebugKotlin` が通ることを確認した
- A142 / Android 16 で `standby -> record -> pause -> resume -> stop -> upload -> Runpod STT -> confirm -> done -> standby` が通った
- recordingId: `cmoebrriy0001lxle1pfthnvn`
- local pending upload は 0 件に戻ることを確認した
- production env から `RUNPOD_API_KEY` を一時 pull して `npm run runpod:status` を実行し、pod `scel1ckkaq7882` が `desiredStatus=EXITED` に戻っていることを確認した
- `#170` は Android native foundation と main flow 実証として close。release handoff / failure recovery / signed APK evidence は `#188` と `#191` に残す

## 注意

- admin 機能は app に入れない
- Android の background start 制約を回避するのではなく、録音開始条件を product 仕様に合わせる
- 録音中 interrupt、foreground service、process death は `#188` の初回校舎 QA で証跡化し、追加修正が必要なら小さい Issue に切る
- 実機 QA 前に phone call / alarm / Bluetooth route など、マイクを奪う状態を外す

## 完了条件

- Android 実機で端末ログインから生徒確認まで main flow が通る
- Android 実機で `録音 -> 一時停止 -> 再開 -> 停止` と `音声アップロード` の両方が通る
- 録音ファイルが local に保持され、upload failure 後に再送できる
- permission denied / microphone unavailable で先生が詰まりにくい
- backend 契約に沿って session / recording / confirm が通る
- STT 完了後に Runpod pod が `stopped` へ戻ることを実機 QA で確認している

## close 時点の扱い

- native app foundation と debug main flow は完了
- standby からの既存音声 upload、network off pending retry、signed release APK install は `#188/#191` の field QA に残す
- Runpod stopped は production env を一時 pull した `RUNPOD_API_KEY` で確認済み。確認後、一時 env file は削除済み
