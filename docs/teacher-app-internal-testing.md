# Teacher App internal testing guide

更新日: `2026-04-26`

Teacher 録音 app は公開ストア前に、校舎共通端末での内部 QA を回します。  
いまは **Play Console を使わず、signed APK を手元 Android に直入れして main flow を確認する** のを最短ルートにします。

## いま repo に入っているもの

- GitHub Actions workflow: `.github/workflows/android-internal-testing.yml`
- signed release APK を作る Android release signing 契約
- workflow 内の preflight:
  - signing secrets の空チェック
  - `.jks` base64 decode / alias 読み取りチェック
  - `app-release.apk` の `apksigner verify`
  - APK の SHA-256 checksum artifact
- 必要ならあとから Play Internal Testing にも拡張できる upload 導線
- localized release notes:
  - `native/android/distribution/whatsnew/whatsnew-ja-JP`
  - `native/android/distribution/whatsnew/whatsnew-en-US`

この workflow は **手動実行 only** です。  
`push` や `main` merge で勝手に配布は走りません。

---

## いまのおすすめ最短ルート

0. `npm run test:android-release-handoff-preflight` で、この repo / CI / 端末が signed APK QA の前提を満たしているか確認する
1. upload 用ではなくてもよいので、**internal build 専用 keystore** を 1 つ作る
2. GitHub Secrets / Variable を 5 個入れる
3. Actions の `Android Device Handoff` を `upload_to_play=false` で実行する
4. artifact から `app-release.apk` と `app-release.apk.sha256` を落とす
5. 手元 Android に `adb install -r` で入れる
6. 実機で `録音 -> 解析 -> 生徒確認 -> 完了 -> 未送信再送` を確認する

このルートでは **Play Console 登録は不要** です。

---

## あなた側でやってほしいこと

### 0. release handoff preflight を実行する

実秘密値を出さずに、signed APK QA 前提だけを確認します。

```bash
npm run test:android-release-handoff-preflight
```

この preflight が見るもの:

- GitHub Actions workflow `.github/workflows/android-internal-testing.yml` の存在
- signing Secrets 名:
  - `ANDROID_UPLOAD_KEYSTORE_BASE64`
  - `ANDROID_UPLOAD_KEYSTORE_PASSWORD`
  - `ANDROID_UPLOAD_KEY_ALIAS`
  - `ANDROID_UPLOAD_KEY_PASSWORD`
- base URL Variable / env:
  - `PARARIA_ANDROID_BASE_URL`
  - local Gradle 側では `PARARIA_BASE_URL`
- `keytool` / `adb` / `native/android` Gradle wrapper 一式
- workflow 内の `keytool -list`、`apksigner verify`、`sha256sum`、artifact upload
- Linux runner で `gradlew` を実行できるようにする `chmod +x ./gradlew`
- `docs/teacher-app-internal-testing.md` の checksum / QA evidence 記録欄
- `.gitignore` が `.tmp/`、`native/android/local.properties`、Android build outputs を無視していること

preflight は秘密値そのもの、password、keystore の中身を出力しません。ローカル環境変数がなくても、`gh secret list` で GitHub Actions Secrets の登録名を確認できる場合は pass にします。値は GitHub から読み出せないため、base64 の中身検査だけは `WARN` のままです。

Windows では、PATH に入っていなくても以下の標準位置を自動検出します。

- `C:\Users\<user>\AppData\Local\Android\Sdk\platform-tools\adb.exe`
- `C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe`
- `ANDROID_HOME` / `ANDROID_SDK_ROOT` / `JAVA_HOME` 配下の標準位置

GitHub Actions でこの npm script を使う場合は、workflow 側で上の secret / variable を環境変数として渡してください。

### 1. internal build 用 keystore を作る

Android Studio の `Build > Generate Signed Bundle / APK` から、internal build 用 keystore を 1 つ作ってください。

必要になる 4 つ:

- keystore ファイルそのもの (`.jks`)
- keystore password
- key alias
- key password

この keystore は **Git に入れない** でください。

### 2. GitHub Secrets / Variable を入れる

repo の `Settings > Secrets and variables > Actions` で、下の名前そのままで登録してください。

#### Secrets

| Name | 中身 |
| --- | --- |
| `ANDROID_UPLOAD_KEYSTORE_BASE64` | `.jks` を base64 化した文字列 |
| `ANDROID_UPLOAD_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_UPLOAD_KEY_ALIAS` | key alias |
| `ANDROID_UPLOAD_KEY_PASSWORD` | key password |

#### Variable

| Name | 中身 |
| --- | --- |
| `PARARIA_ANDROID_BASE_URL` | app が叩く backend base URL。例: `https://pararia.vercel.app` |

`PARARIA_ANDROID_BASE_URL` は空なら workflow default の `https://pararia.vercel.app` が使われます。
指定する場合は `http://` か `https://` で始まる URL にしてください。

#### `.jks` を base64 化する方法

Windows PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\pararia-internal-key.jks"))
```

出てきた 1 行の文字列を、そのまま `ANDROID_UPLOAD_KEYSTORE_BASE64` に入れてください。

#### workflow が落ちる代表例

- `Missing required signing secrets`: Secrets の名前か値が足りません
- `ANDROID_UPLOAD_KEYSTORE_BASE64 is not valid base64`: `.jks` の base64 文字列が壊れています
- `keytool -list` failure: keystore password か key alias が違います
- `PARARIA base URL must start with http:// or https://`: `base_url` input / Variable の形式が違います
- `apksigner verify` failure: release APK が署名済み artifact として扱えません

### 3. GitHub Actions を実行する

GitHub の `Actions` タブから `Android Device Handoff` を開いて、まずはこう実行してください。

- `upload_to_play`: `false`
- `release_status`: そのままで OK
- `release_name`: 空で OK
- `base_url`: 空で OK

これで、signed APK artifact が取れます。

workflow summary に以下が出ます。

- `versionName`
- `versionCode`
- `base URL`
- APK artifact name
- Play upload を skip したかどうか

### 4. artifact を落とす

workflow が終わったら artifact の

- `teacher-android-apk-<versionName>`

を開いて、次の 2 ファイルをダウンロードしてください。

- `app-release.apk`
- `app-release.apk.sha256`

任意ですが、端末へ渡す前に checksum を見るなら PowerShell で確認できます。

```powershell
Get-FileHash .\app-release.apk -Algorithm SHA256
Get-Content .\app-release.apk.sha256
```

### 5. 手元 Android に入れる

一番確実なのは `adb` です。

```bash
adb install -r app-release.apk
```

`-r` は上書き install です。  
同じ keystore で署名された次の build を入れるときも、そのまま更新できます。

ADB なしでやるなら、APK を端末へ送ってファイルを開いて install でも構いません。  
その場合は Android 側で「提供元不明のアプリを許可」が必要になることがあります。

Android の公式 docs でも、APK の実機テストは `adb install path_to_apk` が基本です。  
Sources:
- [Android Debug Bridge (adb)](https://developer.android.com/tools/adb)
- [Run apps on a hardware device](https://developer.android.com/studio/run/device)

### 6. QA evidence を Issue に残す

`#188` のコメントに、最低限この形で残してください。

```txt
workflow run:
artifact:
APK SHA-256:
app versionName:
app versionCode:
base URL:
device:
Android version:
tester:
date:

main flow:
- login:
- record/timer/pause/resume/cancel confirm:
- upload/analyzing:
- student candidate/manual select:
- confirm/done/standby:
- pending retry:

recording IDs:
-

failures / follow-up issues:
-
```

---

## 実機で確認してほしいこと

### 2026-04-25 debug device evidence

- Device: A142 / Android 16
- App: debug APK, `versionName=1.0.0`, `versionCode=1`
- Base URL: `https://pararia.vercel.app`
- Device label: `nothing`
- Recording ID: `cmoebrriy0001lxle1pfthnvn`
- Result: `record -> pause -> resume -> stop -> upload -> Runpod STT -> confirm(no student) -> done -> standby`
- Pending upload after run: `0`
- Runpod status after run: pod `scel1ckkaq7882`, `desiredStatus=EXITED`
- Remaining: signed release APK artifact, network-off pending retry, standby audio upload

### main flow

- [ ] 端末が通話中ではない
- [ ] 通話中に録音開始した場合、server recording を作らず「通話中」エラーで止まる
- [ ] 端末がアラーム / Bluetooth route / 外部マイク切替中ではない
- [ ] login
- [ ] standby から録音開始
- [ ] 録音中 timer が進む
- [ ] 録音中に一時停止 / 再開が自然に使える
- [ ] 録音中キャンセルで二重確認が出て、誤操作で音声が消えない
- [ ] 録音終了後に analyzing へ遷移
- [ ] standby から音声アップロードでも同じ解析経路へ入れる
- [ ] 生徒候補が表示される
- [ ] confirm 後に done へ遷移する
- [ ] 数秒後に standby へ戻る
- [ ] STT 完了後、Runpod pod が `stopped` になって無駄に課金されていない

### failure / recovery

- [ ] microphone denied
- [ ] network off で upload failure
- [ ] pending queue から retry
- [ ] logout 後に bootstrap へ戻る
- [ ] Runpod wake 失敗時に inline OpenAI fallback せず、retry 可能な状態に残る

### device-specific

- [ ] 画面ロック中の挙動
- [ ] app background / foreground 復帰
- [ ] phone call / alarm 介入
- [ ] Bluetooth / 有線マイクの route change
- [ ] Android notification visibility

---

## 校舎責任者向けセットアップ手順

1. app を端末へ入れる
2. 初回だけ校舎用アカウントでログインする
3. 端末名を `校舎名-端末名` 形式で設定する
4. 待機画面まで進み、未送信 0 件を確認する
5. テスト録音を 1 回流し、`録音 -> 解析 -> 生徒確認 -> 完了` を確認する

---

## 不具合報告テンプレート

```txt
端末:
OS:
app version:
校舎:
再現手順:
期待結果:
実際の結果:
録音は残ったか:
未送信一覧に出たか:
スクリーンショット / 動画:
```

## Field diagnostics

- Logcat tag: `ParariaTeacherDiag`
- Quick capture: `adb logcat -d -s ParariaTeacherDiag`
- Live capture: `adb logcat -s ParariaTeacherDiag`
- Error and pending screens include a small `Report memo` area. Copy that text into the bug report when the device can still open the app.
- The report memo and logcat lines include `recordingId`, `deviceLabel`, `appVersion`, `buildNumber`, route, and pending attempt count when available.

---

## あとで Play Internal Testing に広げたくなったら

この repo には、あとから Play Internal Testing に広げる導線も残しています。  
そのときだけ追加で必要になるのはこれです。

- `ANDROID_PLAY_SERVICE_ACCOUNT_JSON` secret
- Play Console の app record
- Play App Signing
- service account の Play Console 権限

workflow 実行時に `upload_to_play=true` にすると、signed AAB も作って internal track upload まで進められます。

---

## 端末 / secret がないと残ること

- Secrets 登録そのものは GitHub repo owner または trusted maintainer が行う
- workflow 実行は Secrets 登録後に GitHub Actions 上で行う
- `app-release.apk` の install / launch は Android 実機が必要
- main flow / failure recovery / lifecycle QA は Android 実機の録画かスクリーンショットで証跡化する
- 校舎責任者への handoff 完了は、責任者端末での install 成功と QA evidence が揃ってから判断する

### 2026-04-26 の設定状態

- GitHub Actions Secrets:
  - `ANDROID_UPLOAD_KEYSTORE_BASE64`
  - `ANDROID_UPLOAD_KEYSTORE_PASSWORD`
  - `ANDROID_UPLOAD_KEY_ALIAS`
  - `ANDROID_UPLOAD_KEY_PASSWORD`
- GitHub Actions Variable:
  - `PARARIA_ANDROID_BASE_URL=https://pararia.vercel.app`
- 内部配布用 keystore fingerprint:
  - keystore SHA-256: `173ac2c10fd84370d59d7f4c666bf60dff3c0d9145e3bba8d89d86eb16e6ddd8`
  - alias: `pararia-internal-upload`
- 秘密値と `.jks` 本体は Git に入れない。生成時のローカル一時ファイルは削除済み。

### 2026-04-26 signed APK evidence

- GitHub Actions run: `24949663628`
- Run URL: `https://github.com/MIRR-LUKE/pararia/actions/runs/24949663628`
- Commit: `cbdd066508053bb510b0bad57efe599f6aab8a27`
- Artifact: `teacher-android-apk-1.0.0-internal.2`
- APK: `app-release.apk`
- versionName: `1.0.0-internal.2`
- versionCode: `1002`
- base URL: `https://pararia.vercel.app`
- APK SHA-256: `105a2399c3459b0f5d06d2c064131809bf0a1cf3abe10be602e5a428b79a412b`
- Signer certificate SHA-256 digest: `80ac90f78f40e045d3e2db320605760fbbe182b98538aa75d187ee1544600730`
- CI `apksigner verify`: pass
- Local `apksigner verify --verbose --print-certs`: pass
- Play upload: skipped
- Signed release APK の install / launch / main flow / pending retry QA は A142 実機で完了

### 2026-04-26 signed release device QA evidence

- Device: A142 / Android 16 / SDK 36
- Package: `jp.pararia.teacherapp`
- App: signed release APK, `versionName=1.0.0-internal.2`, `versionCode=1002`
- Install time: `2026-04-26 15:18:48`
- Device label: `A142ReleaseQA`
- Login: `admin@demo.com`, role `管理者`
- Base URL: `https://pararia.vercel.app`
- Main flow audio: `【小輪瀬君】12-13-インタビュー_-大学受験数学の過去問戦略と共通テスト対策.mp3`
- Main flow audio size/duration: `2,861,217 bytes`, `715.248s`
- Main flow recordingId: `cmofdv9z500093e81qshvwhbo`
- Main flow STT job: `cmofdveac0005t2ozb90m967d`, `DONE`, attempts `1`, lastError `null`
- Main flow student: `田中太郎` (`cmn784mqr0001ix8zumd351l4`)
- Promoted Session: `cmofdzuwh000c3e81h92rzl6i`, `INTERVIEW`, `READY`
- ConversationLog: `cmofdzva3000i3e818n6mlyzb`, `DONE`
- NextMeetingMemo: `READY`
- Failure recovery recordingId: `cmofeltzm000u3e8199yzy9yx`
- Failure recovery: upload phase で network off -> `pending_queued attemptCount=1` -> `未送信 1`
- Retry recovery: `未送信を確認` -> `まとめて再送` -> `upload_success` -> `retry_upload_success attemptCount=2` -> `retry_result attempted=1 remaining=0`
- Retry recording result: `TRANSCRIBING` -> `AWAITING_STUDENT_CONFIRMATION` -> `生徒なしで保存` -> `confirm_success` -> `done` -> `READY`
- Retry STT job: `cmofeo7kc0003vvf5wzbptcki`, `DONE`, attempts `1`, lastError `null`
- Runpod status after QA: pod `scel1ckkaq7882`, `desiredStatus=EXITED`, lastStartedAt `2026-04-26 06:47:05.77 +0000 UTC`
- Network restored after QA: Wi-Fi and cellular internet validated
- IME restored after QA: `com.adamrocker.android.input.simeji/.OpenWnnSimeji`

### この端末で残る作業

2026-04-26 時点で、この端末は `keytool` と `adb` を標準インストール先から検出できます。ただし `adb devices -l` に実機が出ていない場合は、signed APK の install / launch / QA 完了までは進めません。

- `keytool` が無い場合:
  - Android Studio JBR または JDK 17 以上を install し、`npm run test:android-release-handoff-preflight` を再実行する
- `adb` が無い場合:
  - Android SDK Platform Tools を install し、端末の USB debugging を有効化して `adb devices -l` で認識を確認する
- signing Secrets が無い場合:
  - GitHub repo owner が Actions Secrets / Variable を登録する
  - local で検査する場合も secret 値は `.tmp/` 配下の一時 env などに置き、Git に入れない
- Android 実機が無い場合:
  - `adb install -r app-release.apk`、起動確認、main flow、failure recovery、QA evidence 記録は未完了として残す

この端末に `keytool` / `adb` が無い状態で preflight が落ちても、repo 側の変更は失敗ではありません。残作業として Issue `#188` の QA evidence に明記してください。

---

## close 条件との関係

- `#188` は、この workflow と secret 契約、internal build handoff、実機 QA 手順が揃って初めて close 候補
- `#170` は、ここに沿った Android 実機 main flow 確認が終わるまで open のまま
- `#189` は repo 側完了。実機 QA では `ParariaTeacherDiag` と調査メモコピーを証跡に含める
- `#191` は、Android-only の現場投入親 Issue として最後に close する
- `#165`, `#167`, `#171`, `#173` は `2026-04-25` に close / superseded。iOS / TestFlight / App Store は現時点では scope 外

---

## 参考

- Android Debug Bridge (adb): https://developer.android.com/tools/adb
- Run apps on a hardware device: https://developer.android.com/studio/run/device
- Android App Signing: https://developer.android.com/studio/publish/app-signing
- Android developer verification FAQ: https://developer.android.com/developer-verification/guides/faq
