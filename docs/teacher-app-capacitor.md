# Teacher App Capacitor セットアップ

更新日: `2026-04-19`

## 目的

既存の Next.js `/teacher` 導線をそのまま使い、**remote-hosted の Teacher App を iOS / Android の native shell で包む**ための最小セットアップを repo に置く。

この段階では web app を static export しない。  
初期構成は次の形でそろえる。

- native shell: Capacitor
- WebView の接続先: deploy 済み PARARIA origin
- 開始パス: `/teacher`

## いま repo に入っているもの

- `@capacitor/core`
- `@capacitor/cli`
- `@capacitor/ios`
- `@capacitor/android`
- `capacitor.config.ts`
- `ios/`
- `android/`
- `www/index.html`
- `npm run cap:*` scripts

## remote-hosted 戦略

Capacitor config は `server.url` と `server.appStartPath` を使って、native shell 起動時に deployed PARARIA を開く。

- origin: `PARARIA_CAPACITOR_SERVER_ORIGIN`
- start path: `PARARIA_CAPACITOR_START_PATH`

既定値:

- `PARARIA_CAPACITOR_SERVER_ORIGIN=https://pararia.vercel.app`
- `PARARIA_CAPACITOR_START_PATH=/teacher`
- `PARARIA_CAPACITOR_APP_ID=jp.pararia.teacher`
- `PARARIA_CAPACITOR_APP_NAME=PARARIA Teacher`

`PARARIA_CAPACITOR_SERVER_ORIGIN` が `http://...` のときだけ `cleartext=true` になる。production 相当では `https://...` を使う。

Capacitor 公式 docs では `server.url` を live reload 用として説明しているが、この repo では **Teacher App を最短で native shell 化する初期戦略** として使う。  
store 提出前に bundled web assets へ寄せるかどうかは別 issue で判断する。

## いま通る確認コマンド

2026-04-19 時点で、次はこの repo で通る。

```bash
npm run typecheck
npm run cap:doctor
npm run cap:sync
```

## ローカルセットアップ

1. 依存を入れる

```bash
npm install
```

2. 接続先を決める

```bash
$env:PARARIA_CAPACITOR_SERVER_ORIGIN="https://pararia.vercel.app"
$env:PARARIA_CAPACITOR_START_PATH="/teacher"
```

bundle id や app 名を変える場合は、native project を作る前に一緒に入れる。

```bash
$env:PARARIA_CAPACITOR_APP_ID="jp.pararia.teacher"
$env:PARARIA_CAPACITOR_APP_NAME="PARARIA Teacher"
```

3. config を native project に反映する

```bash
npm run cap:sync
```

4. IDE で開く

```bash
npm run cap:open:ios
npm run cap:open:android
```

## native project を作り直すとき

repo にはすでに `ios/` と `android/` が入っている。  
bundle id や app 名を大きく変えて native project を作り直したいときだけ、いったん削除してから次を使う。

```bash
npm run cap:add:ios
npm run cap:add:android
```

## 権限まわり

録音用のマイク権限は native 側に反映済み。

### iOS

- `ios/App/App/Info.plist`
- `NSMicrophoneUsageDescription`
- 文言: `面談録音を行うためにマイクを使用します。`

### Android

- `android/app/src/main/AndroidManifest.xml`
- `android.permission.RECORD_AUDIO`
- `android.permission.MODIFY_AUDIO_SETTINGS`

## fallback bundle

`www/index.html` は remote-hosted shell 用の最小 fallback。  
Capacitor sync が webDir 不在で止まらないようにしてあり、WebView が開けないときは接続確認メッセージだけを出す。

## 運用メモ

- 接続先 origin を変えたら `npm run cap:sync` をやり直す
- iOS の build / 実機実行は macOS + Xcode が必要
- Android の build / 実機実行は Android Studio が必要
- 初期段階では remote-hosted shell を優先し、録音 lifecycle の hardening は別 issue `#165` で進める
- WebView 側の実フローは既存 `/teacher` が正本なので、UI や domain logic の改修はここでは行わない
