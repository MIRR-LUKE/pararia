# Teacher Native Apps

Teacher 録音 app は `web を包む` のではなく、**完全ネイティブ**で実装する。

このディレクトリの責務は次の 2 つ。

1. `ios/`: SwiftUI ベースの iOS Teacher App
2. `android/`: Kotlin + Jetpack Compose ベースの Android Teacher App

共通方針:

- 録音 app の責務は `録る / 終える / 確認する / 送る`
- 生徒管理、レポート確認、設定、監査は既存 web に残す
- backend 契約の正本は `docs/teacher-app-native-auth-contract.md`
- lifecycle 方針は `docs/teacher-app-lifecycle-policy.md`
- internal QA / 配布メモは `docs/teacher-app-internal-testing.md`
- UI と domain logic を分ける
- 録音 core、upload queue、API client は protocol / interface で抽象化する
- provisional UI でも state holder / repository 境界を崩さない

platform best practices:

- iOS は `AVAudioSession` の録音 permission と interrupt handling を正面から扱う
- Android は microphone foreground service と while-in-use 制約を前提にする
- Compose / SwiftUI ともに state は hoist し、画面から副作用を直接広げすぎない

参考:

- Apple: `AVAudioSession` / recording permission
- Android: foreground service microphone restrictions
- Android: Compose state hoisting
