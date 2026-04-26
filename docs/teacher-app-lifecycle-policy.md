# Teacher App lifecycle policy

更新日: `2026-04-26`

Teacher 録音 app の lifecycle は、実機 QA の前から方針を固定しておきます。  
ここでは「何を続行し、何を中断扱いにするか」を先に決めます。

2026-04-25 時点では Android-only で現場投入を進めます。iOS interrupt / route change / TestFlight は必要になった時点で新 Issue として再開します。

## 現在の方針

### 1. 録音開始は foreground でしか行わない

- Android は visible activity 上の先生操作からのみ録音開始する
- microphone foreground service は visible activity がある前提で起動する

この方針は Android の while-in-use 制約と foreground service 制約に合わせています。  
Sources:
- https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
- https://developer.android.com/develop/background-work/services/fgs/launch

### 2. 録音開始に失敗したら server 側 recording を best-effort で cancel する

- `createRecording()` 成功後に native recorder 起動が失敗した場合は orphan を残さない
- app はそのまま standby に戻し、先生には録音やり直しだけを求める

### 3. upload 成功後は local audio file を削除する

- retry が必要なのは upload failure のときだけ
- success-path の音声ファイルは native app 内に残し続けない

### 4. upload failure は pending queue へ送る

- duration と attempt count を pending item に残す
- retry は 1 件失敗しても残りを続ける
- pending queue は「録音し直し」ではなく「再送」の導線として残す

### 5. upload 成功後の STT は server / Runpod 側で続行する

- app が閉じていても、録音ファイルが upload 済みなら STT は server queue と Runpod worker が続行する
- STT 完了後、Firebase 設定済みの Android 端末には push 通知を送り、app を開いたら active recording を復元して生徒確認へ戻す
- 最終失敗時も push 通知を送り、端末側 polling だけに依存しない
- Firebase 未設定 build / server env 未設定では通知だけ no-op とし、録音・upload・polling は壊さない

### 6. 中断された live recording は「再送」ではなく「やり直し」に寄せる

- live microphone capture 中に app / OS 側で中断されたケースは、partial file の正確な rescue より main flow の明快さを優先する
- つまり、recover 不能な live recording は pending queue へ無理に混ぜず、standby から録音し直す

## Android 実装メモ

- foreground service は `ServiceCompat.startForeground(..., FOREGROUND_SERVICE_TYPE_MICROPHONE)` を前提にする
- `POST_NOTIFICATIONS` は Android 13+ の内部 QA で確認する
- notification permission は FGS 起動の絶対条件ではないが、録音中 notification visibility は QA 項目に残す

Sources:
- https://developer.android.com/guide/topics/ui/notifiers/notification-permission
- https://developer.android.com/about/versions/14/changes/fgs-types-required
- https://developer.android.com/reference/kotlin/android/content/pm/ServiceInfo

## iOS 実装メモ

iOS は現時点では scope 外。必要になったら、Xcode project / target / `xcodebuild` / 実機 QA を新しい Issue として切り直す。

## 実機 QA で閉じる項目

- app background / foreground 復帰
- phone call / alarm / route change
- permission denied / permission revoke 後の戻り導線
- screen off 中の録音継続
- process death 後の pending queue と server state の整合
