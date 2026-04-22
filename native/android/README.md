# PARARIA Teacher Native App for Android

`native/android` は、先生向け録音 app の Android native foundation です。

## 目的

- 校舎共通端末ログイン
- 待機 -> 録音 -> 解析中 -> 生徒確認 -> 完了 -> 未送信一覧
- app private storage への録音保存
- foreground service 前提の microphone capture
- bearer token + refresh token 契約で backend に接続
- process death 後も復元できる未送信キュー

## 構成

- `app/src/main/java/jp/pararia/teacherapp/app`
  - 手動 DI container
- `app/src/main/java/jp/pararia/teacherapp/domain`
  - UI と data layer の共有 model / contract
- `app/src/main/java/jp/pararia/teacherapp/data`
  - DataStore 永続化、HTTP client、repository
- `app/src/main/java/jp/pararia/teacherapp/recording`
  - `MediaRecorder` と microphone foreground service
- `app/src/main/java/jp/pararia/teacherapp/ui`
  - Compose UI と `ViewModel`

## 補足

- foreground service の background-start 回避ではなく、**visible activity 上の先生操作からのみ録音開始**する前提です。
- API base URL は `PARARIA_BASE_URL` gradle property で切り替えられます。既定値は `https://pararia.vercel.app` です。
- pending upload は `duration / attempt count / last attempt` を保持し、retry queue でメタデータを落とさないようにしています。
- foreground service は `ServiceCompat.startForeground(..., FOREGROUND_SERVICE_TYPE_MICROPHONE)` 前提に寄せています。
- local build / emulator verification は Android SDK と JDK が入った端末で続けます。この workspace では Java / Gradle が未導入のため source review までです。
- Play Internal Testing 用の GitHub Actions workflow は `.github/workflows/android-internal-testing.yml` です。
- GitHub Secrets / Variables と Play Console 側の準備は `docs/teacher-app-internal-testing.md` にまとめています。
