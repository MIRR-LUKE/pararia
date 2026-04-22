# Teacher App internal testing guide

更新日: `2026-04-22`

Teacher 録音 app は公開ストア前に、校舎共通端末での内部 QA を回します。  
ここでは **Android Play Internal Testing を先に通す** 前提で、repo 側に入った workflow と、あなた側で必要な準備を 1 枚で追えるようにまとめます。

## いま repo に入っているもの

- GitHub Actions workflow: `.github/workflows/android-internal-testing.yml`
- signed release AAB を作る Android release signing 契約
- Play Internal Testing へ upload するための secret 契約
- localized release notes:
  - `native/android/distribution/whatsnew/whatsnew-ja-JP`
  - `native/android/distribution/whatsnew/whatsnew-en-US`

この workflow は **手動実行 only** です。  
`push` や `main` merge で勝手に Play 配布は走りません。

---

## 最短の流れ

1. Play Console で Android app を作る
2. Play App Signing を有効にする
3. upload keystore を作る
4. Play Developer API 用 service account を作る
5. GitHub Secrets / Variables を入れる
6. Actions の `Android Internal Testing` を `upload_to_play=false` で 1 回回す
7. build artifact が取れたら `upload_to_play=true` で rerun する
8. internal testing の tester link から手元の Android 端末に入れる

---

## あなた側でやってほしいこと

### 1. Play Console に app を作る

Play Console で新しい Android app を作成してください。

- package name: `jp.pararia.teacherapp`
- app name: `PARARIA Teacher App` など分かりやすい名前
- 配布先: まずは `Internal testing`

大事なのは、**この package 名の app record を先に Play Console に作っておくこと**です。  
これがないと API upload が `Package not found` で止まります。

### 2. Play App Signing を有効にする

Play App Signing 前提で進めてください。  
Google 管理の app signing key と、こちらで持つ upload key を分ける構成です。

### 3. upload keystore を作る

Android Studio の `Build > Generate Signed Bundle / APK` から、upload 用 keystore を 1 つ作ってください。

必要になる 4 つ:

- keystore ファイルそのもの (`.jks`)
- keystore password
- key alias
- key password

この keystore は **Git に入れない** でください。

### 4. Play Developer API 用 service account を作る

必要なのは、Play Console upload 用の service account JSON です。

やること:

1. Google Cloud で `Android Publisher API` を有効化
2. service account を 1 つ作る
3. JSON key を発行
4. Play Console の `Users and permissions` で、その service account のメールアドレスを招待
5. 対象 app に対して release upload できる権限を付与

### 5. GitHub Secrets / Variables を入れる

repo の `Settings > Secrets and variables > Actions` で、下の名前そのままで登録してください。

#### Secrets

| Name | 中身 |
| --- | --- |
| `ANDROID_UPLOAD_KEYSTORE_BASE64` | `.jks` を base64 化した文字列 |
| `ANDROID_UPLOAD_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_UPLOAD_KEY_ALIAS` | key alias |
| `ANDROID_UPLOAD_KEY_PASSWORD` | key password |
| `ANDROID_PLAY_SERVICE_ACCOUNT_JSON` | service account JSON の中身そのまま |

#### Variable

| Name | 中身 |
| --- | --- |
| `PARARIA_ANDROID_BASE_URL` | app が叩く backend base URL。例: `https://pararia.vercel.app` |

#### `.jks` を base64 化する方法

Windows PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\pararia-upload-key.jks"))
```

出てきた 1 行の文字列を、そのまま `ANDROID_UPLOAD_KEYSTORE_BASE64` に入れてください。

### 6. GitHub Actions を実行する

GitHub の `Actions` タブから `Android Internal Testing` を開いて、まずはこう実行してください。

#### 1 回目: build 確認

- `upload_to_play`: `false`
- `release_status`: `completed`
- `release_name`: 空で OK
- `base_url`: 空で OK

これで、signed AAB が artifact として取れるか確認します。

#### 2 回目: Play Internal Testing へ upload

- `upload_to_play`: `true`
- `release_status`: 通常は `completed`
- `release_name`: 空で OK
- `base_url`: 空で OK

もし brand new app で Play 側が

`Only releases with status draft may be created on draft app`

と言ってきたら、その回だけ `release_status=draft` で通してください。  
Play Console 側の初期設定が整ったあとに、`completed` で rerun すれば大丈夫です。

---

## workflow の動き

`Android Internal Testing` workflow は次を行います。

1. Java 17 を入れる
2. Gradle 8.9 を入れる
3. Android SDK platform 35 / build tools 34.0.0 を入れる
4. GitHub Secrets から upload keystore を復元する
5. signed `app-release.aab` を作る
6. artifact として保存する
7. `upload_to_play=true` のときだけ Play internal track へ upload する

version は workflow run ごとに自動でこう付きます。

- versionCode: `1000 + GitHub run number`
- versionName: `1.0.0-internal.<run number>`

---

## 校舎責任者向けセットアップ手順

1. app を端末へ入れる
2. 初回だけ校舎用アカウントでログインする
3. 端末名を `校舎名-端末名` 形式で設定する
4. 待機画面まで進み、未送信 0 件を確認する
5. テスト録音を 1 回流し、`録音 -> 解析 -> 生徒確認 -> 完了` を確認する

---

## QA checklist

### main flow

- [ ] login
- [ ] standby から録音開始
- [ ] 録音中 timer が進む
- [ ] 録音終了後に analyzing へ遷移
- [ ] 生徒候補が表示される
- [ ] confirm 後に done へ遷移する
- [ ] 数秒後に standby へ戻る

### failure / recovery

- [ ] microphone denied
- [ ] network off で upload failure
- [ ] pending queue から retry
- [ ] logout 後に bootstrap へ戻る

### device-specific

- [ ] 画面ロック中の挙動
- [ ] app background / foreground 復帰
- [ ] phone call / alarm 介入
- [ ] Bluetooth / 有線マイクの route change
- [ ] Android notification visibility

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

## close 条件との関係

- `#167` は、この workflow と secret 契約、internal build handoff、実機 QA 手順が揃って初めて close 候補
- `#170` / `#173` は、ここに沿った実機 main flow 確認が終わるまで open のまま
- `#165` は、画面ロック / background / interrupt を実機で潰すまで open のまま

---

## 参考

- Android App Bundle / Play App Signing: https://developer.android.com/studio/publish/app-signing
- Android Gradle Plugin 8.7 compatibility: https://developer.android.com/build/releases/past-releases/agp-8-7-0-release-notes
- Gradle setup action: https://github.com/gradle/actions/blob/main/docs/setup-gradle.md
