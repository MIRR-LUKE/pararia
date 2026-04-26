# Android Teacher App の signed APK handoff と初回校舎 QA を完了する

## 状態

- Open
- GitHub Issue: `#188`
- 最終更新: `2026-04-26`

## 2026-04-25 repo 側で完了したこと

- `Android Device Handoff` workflow に signing secret preflight を追加
- `.jks` base64 decode / alias check を追加
- base URL validation を追加
- release APK build 後に `apksigner verify` を実行
- APK と `app-release.apk.sha256` を同じ artifact に含める
- workflow summary に version / base URL / artifact / install command / QA 証跡メモを出す
- `docs/teacher-app-internal-testing.md` に checksum 確認と QA evidence template を追加
- debug APK は実機 A142 / Android 16 へ install / launch 済み
- 横向き時に standby の録音ボタンが隠れる問題を見つけ、portrait 固定を追加
- debug APK で `record -> pause -> resume -> stop -> upload -> confirm -> done -> standby` が通った
- recordingId: `cmoebrriy0001lxle1pfthnvn`
- Runpod status: pod `scel1ckkaq7882` は `desiredStatus=EXITED`

## 2026-04-26 進捗

- `test:android-release-handoff-preflight` が Windows 標準インストール先の `adb` / `keytool` を検出できるようにした
- 内部配布用 keystore を新規生成し、GitHub Actions Secrets へ登録した
- `PARARIA_ANDROID_BASE_URL=https://pararia.vercel.app` を GitHub Actions Variable へ登録した
- secret 値と `.jks` 本体は Git に入れず、生成時のローカル一時ファイルは削除済み
- keystore SHA-256: `173ac2c10fd84370d59d7f4c666bf60dff3c0d9145e3bba8d89d86eb16e6ddd8`
- `npm run test:android-release-handoff-preflight` は `9 passed, 1 warned, 0 failed`
- `Android Device Handoff` run `24949634631` は signing secret / keystore decode まで通り、Linux runner の `gradlew` 実行権限で停止した
- workflow に `chmod +x ./gradlew` を追加し、preflight の必須チェックにも入れた

## 残り

- GitHub Actions 上で実 keystore を使って workflow を実行する
- Android 実機へ `app-release.apk` を install / launch する
- main flow と failure recovery の QA evidence を `#188` に残す
- GitHub Actions の signed release artifact で同じ main flow を流す
- network off / pending retry / audio file upload の failure recovery を流す
- `2026-04-25` audit: workflow / docs は secrets 登録前に確認できる範囲まで hardening 済み。実機 QA と Secrets 登録は残る。

## 目的

Android Teacher App を Play / App Store 前提にせず、signed release APK を校舎端末へ渡して初回 QA できる状態にする。

## 現状

- `native/android` に完全 native Android app foundation がある
- `Android Device Handoff` workflow は `upload_to_play=false` で signed APK artifact を出す設計になっている
- workflow は signing secrets の空チェック、keystore base64 decode、keystore alias 読み取り、APK の `apksigner verify`、SHA-256 checksum 出力まで行う
- `docs/teacher-app-internal-testing.md` は APK 直入れ、secret セットアップ、artifact 取得、install、QA evidence template を正本に更新済み
- `#170` は Android app main flow の実機確認として残す

## やること

- [x] workflow が `upload_to_play=false` で Play secret なしに APK build へ進めることを確認する
- [x] workflow に signing secret / keystore / base URL / APK signature の validation を入れる
- [x] artifact に `app-release.apk` と `app-release.apk.sha256` が入るようにする
- [x] human handoff docs に Secrets / Variable / workflow inputs / install / QA evidence を明記する
- [x] internal build 用 keystore を用意する
- [x] GitHub Secrets / Variable を入れる
- [ ] `Android Device Handoff` を `upload_to_play=false` で実行する
- [ ] signed release APK artifact を取得する
- [ ] 実 Android 端末へ install / launch する
- [ ] 校舎 QA 用に device / OS / app version / build number / base URL / recording ID を記録する

## workflow 入力

- `upload_to_play=false`: signed APK artifact のみ作る。Play Console / service account は不要。
- `release_status`: `upload_to_play=false` では実質未使用。
- `release_name`: 空なら `android-internal-<versionName>`。
- `base_url`: 空なら GitHub Variable `PARARIA_ANDROID_BASE_URL`、それも空なら `https://pararia.vercel.app`。

## 必要な GitHub 設定

Secrets:

- `ANDROID_UPLOAD_KEYSTORE_BASE64`
- `ANDROID_UPLOAD_KEYSTORE_PASSWORD`
- `ANDROID_UPLOAD_KEY_ALIAS`
- `ANDROID_UPLOAD_KEY_PASSWORD`

Variable:

- `PARARIA_ANDROID_BASE_URL`

Play Internal Testing まで広げる時だけ追加:

- `ANDROID_PLAY_SERVICE_ACCOUNT_JSON`

## 残る device / workflow 依存

- GitHub Actions 上での actual release build 実行
- artifact から APK / checksum を取得して責任者端末へ渡す作業
- Android 実機での signed release install / launch / main flow / failure recovery QA
- QA evidence を Issue コメントか docs に残す作業

## 完了条件

- signed release APK を少なくとも 1 台の Android 端末へ渡せる
- debug build ではなく release artifact で main flow を確認できる
- QA 結果が Issue コメントか docs に残っている
- 失敗があれば、次に直す Issue へ分割されている
