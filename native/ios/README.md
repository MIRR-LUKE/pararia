# Teacher native iOS foundation

更新日: `2026-04-19`

## 目的

`native/ios` は、Teacher 録音 app を **完全ネイティブ iOS** で進めるための土台です。  
管理画面は web に残し、ここでは次だけを責務にします。

- 端末ログイン
- 録音開始 / 停止
- 音声の local 保持
- upload / 再送
- 生徒候補確認
- 完了 / 未送信導線

## 設計の要点

### 1. SwiftUI は view、状態遷移は Coordinator

- `App/TeacherAppCoordinator.swift` を単一の state holder にしています
- 画面ごとの SwiftUI view は `UI/TeacherScreens.swift` に薄く寄せています
- view は入力と action だけ受け、録音・認証・queue は直接触りません

### 2. 録音 core は protocol 抽象化

- `Infrastructure/TeacherAudioRecorder.swift`

`AVAudioSession` と `AVAudioRecorder` を使う実装を本命にしています。音声 session 設定は recording core に閉じ込め、UI は開始 / 停止の action だけを知る構造です。

### 3. upload queue は store / repository / service を分離

- `Infrastructure/TeacherRepositories.swift`

`FilePendingUploadStore` が disk persistence を持ち、`DefaultTeacherRecordingRepository` が queue 追加と retry を受け持ちます。

保存形式を変えても、UI や録音ロジックに波及しにくい境界にしています。

### 4. auth は native bearer contract 前提

- `Infrastructure/TeacherAPIClient.swift`
- `Infrastructure/TeacherRepositories.swift`
- `Infrastructure/TeacherTokenStore.swift`

既存 backend の `/api/teacher/native/auth/*` を使います。access token は短命、refresh token は rotate 前提なので、repository 側で refresh と 401 retry を 1 回だけ持たせています。

### 5. provisional UI だが責務は最終形に合わせる

画面は仕様通りに分けています。

- bootstrap / login
- standby
- recording
- analyzing
- confirm
- done
- pending

見た目は仮ですが、状態遷移と action はこのまま最終 UI に差し替えやすい構造です。

## ファイルマップ

```txt
native/ios/
  README.md
  TeacherNativeApp/
    App/
    Domain/
    Infrastructure/
    Resources/
    UI/
```

`TeacherNativeApp/Resources/Info.plist` には、`PARARIAApiBaseURL` と `NSMicrophoneUsageDescription` を入れています。

## 未検証点

この環境では Xcode / iOS Simulator / 実機が使えないため、以下は **未検証** です。

- SwiftUI app としての build 通過
- `Security` framework を使った Keychain 永続化
- `AVAudioSession` category / route の実機挙動
- 実ファイル upload の multipart 送信
- microphone permission denied / interrupted / route change の実機挙動

とくに interrupt / route change / app background 復帰は `#165` で実機 QA しながら詰める前提です。

## 次にやること

1. Xcode project / target を追加してこの source tree を組み込む
2. `Info.plist` と signing を入れる
3. 実機で login -> recording -> upload -> confirm を通す
4. `#165` の lifecycle hardening を実機前提で詰める
