# Teacher App internal testing guide

更新日: `2026-04-22`

Teacher 録音 app は公開ストア前に、校舎共通端末での内部 QA を回します。  
いまは **Play Console を使わず、signed APK を手元 Android に直入れして main flow を確認する** のを最短ルートにします。

## いま repo に入っているもの

- GitHub Actions workflow: `.github/workflows/android-internal-testing.yml`
- signed release APK を作る Android release signing 契約
- 必要ならあとから Play Internal Testing にも拡張できる upload 導線
- localized release notes:
  - `native/android/distribution/whatsnew/whatsnew-ja-JP`
  - `native/android/distribution/whatsnew/whatsnew-en-US`

この workflow は **手動実行 only** です。  
`push` や `main` merge で勝手に配布は走りません。

---

## いまのおすすめ最短ルート

1. upload 用ではなくてもよいので、**internal build 専用 keystore** を 1 つ作る
2. GitHub Secrets / Variable を 5 個入れる
3. Actions の `Android Device Handoff` を `upload_to_play=false` で実行する
4. artifact から `app-release.apk` を落とす
5. 手元 Android に `adb install -r` で入れる
6. 実機で `録音 -> 解析 -> 生徒確認 -> 完了 -> 未送信再送` を確認する

このルートでは **Play Console 登録は不要** です。

---

## あなた側でやってほしいこと

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

#### `.jks` を base64 化する方法

Windows PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\pararia-internal-key.jks"))
```

出てきた 1 行の文字列を、そのまま `ANDROID_UPLOAD_KEYSTORE_BASE64` に入れてください。

### 3. GitHub Actions を実行する

GitHub の `Actions` タブから `Android Device Handoff` を開いて、まずはこう実行してください。

- `upload_to_play`: `false`
- `release_status`: そのままで OK
- `release_name`: 空で OK
- `base_url`: 空で OK

これで、signed APK artifact が取れます。

### 4. artifact を落とす

workflow が終わったら artifact の

- `teacher-android-apk-<versionName>`

を開いて、`app-release.apk` をダウンロードしてください。

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

---

## 実機で確認してほしいこと

### main flow

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

## close 条件との関係

- `#167` は、この workflow と secret 契約、internal build handoff、実機 QA 手順が揃って初めて close 候補
- `#170` は、ここに沿った Android 実機 main flow 確認が終わるまで open のまま
- `#165` は、画面ロック / background / interrupt を実機で潰すまで open のまま
- `#173` は iOS 側の話なので、Android APK 直入れでは close しない

---

## 参考

- Android Debug Bridge (adb): https://developer.android.com/tools/adb
- Run apps on a hardware device: https://developer.android.com/studio/run/device
- Android App Signing: https://developer.android.com/studio/publish/app-signing
- Android developer verification FAQ: https://developer.android.com/developer-verification/guides/faq
