# iOS native Teacher App の録音基盤と最小 UI を作る

## 状態

- Open
- GitHub Issue: `#173`
- 最終更新: `2026-04-21`

## 目的

iPhone / iPad で、Teacher 録音導線を **完全ネイティブ**で通せるようにする。  
MVP では、先生が迷わず `待機 -> 録音 -> 解析中 -> 生徒確認 -> 完了 -> 未送信一覧` を通れることを最優先にする。

## 親 issue

- `#171` / `93` Teacher 録音 app を完全ネイティブ前提で作り直す全体計画

## 方針

- UI は SwiftUI を基本にする
- 録音は `AVAudioSession` と iOS の録音 API を正面から使う
- 録音ファイルは app sandbox に保存する
- upload queue は app 再起動後も復元できる形にする

## この issue でやること

- iOS app の project foundation を作る
- 校舎共通端末 login / bootstrap を native で通す
- 待機画面、録音中画面、解析中画面、生徒確認画面、完了画面、未送信一覧を仮 UI で作る
- microphone permission と denied state を native UI で扱う
- local recording, local file retention, retryable upload queue を入れる
- backend から student candidates を受けて確定できるようにする

## 2026-04-21 までに repo へ入ったもの

- `TeacherAppCoordinator` で `createRecording -> recorder.start` の途中失敗時に server recording を best-effort cancel するようにした
- pending upload に `duration / attemptCount / lastAttemptAt` を持たせた
- upload success 後に local audio file を削除するようにした
- recorder の保存先を `temporaryDirectory` から `Application Support/TeacherRecordings` に移した
- `401` 後の retry で expiry 判定を飛ばせる `forceRefresh` 経路を入れた
- `Config/Debug.xcconfig`, `Config/Release.xcconfig`, `Assets.xcassets`, `LaunchScreen.storyboard` を追加して、Xcode project 化の前提を揃えた

## 注意

- admin 機能は app に入れない
- まずは iOS で main flow を確実に通すことを優先し、デザイン polish は後回し
- 録音中 interrupt や route change の本格 hardening は `#165` で詰める

## 完了条件

- iOS 実機で端末ログインから生徒確認まで main flow が通る
- 録音ファイルが local に保持され、upload failure 後に再送できる
- permission denied / microphone unavailable で先生が詰まりにくい
- backend 契約に沿って session / recording / confirm が通る
