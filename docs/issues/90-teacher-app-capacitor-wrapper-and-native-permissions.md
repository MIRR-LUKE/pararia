# Capacitor で iOS / Android host app を作る

## 状態

- Closed
- GitHub Issue: `#166`
- 最終更新: `2026-04-19`

## 目的

既存 Next.js の Teacher App を活かしたまま、**iOS / Android の installable app** として動かせる host project を追加する。

## 親 issue

- `#169` / `88` Teacher App を iOS / Android app として使える形に進める

## 方針

- app 本体を書き直さず、Capacitor で native shell を作る
- 初期版は **remote-hosted** を前提にする  
  `ios / android app -> WebView -> deployed PARARIA /teacher`
- static export 前提にはしない

## この issue でやること

- Capacitor の導入
- `ios/` と `android/` project の生成と repo 管理方針の整理
- `capacitor.config` の追加
- dev / staging / production の接続先 URL の決め方を明文化
- iOS `Info.plist` と Android `AndroidManifest` の microphone permission 文言を整える
- WebView 内で Teacher App session が維持されることを確認する
- build / sync / run の基本コマンドを README か専用 doc に追加する

## 注意

- ここではまだ録音 lifecycle の細かい hardening は完了条件に含めない
- まずは `開く / ログインする / 録音画面へ入る` までを確実に通す

## 実装したこと

- `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, `@capacitor/android` を導入した
- `capacitor.config.ts` を追加し、remote-hosted `/teacher` shell と env 切り替えを定義した
- `ios/` と `android/` の native project を repo に追加した
- `www/index.html` の最小 fallback bundle を追加し、`cap sync` がそのまま通るようにした
- `ios/App/App/Info.plist` に `NSMicrophoneUsageDescription` を入れた
- `android/app/src/main/AndroidManifest.xml` に `RECORD_AUDIO` と `MODIFY_AUDIO_SETTINGS` を入れた
- README と `docs/teacher-app-capacitor.md` に setup / sync / open 手順を追加した

## 確認

- `npm run cap:doctor`
- `npm run cap:sync`
- `npm run typecheck`

## 完了条件

- iOS / Android の native project が repo に追加される
- app から ` /teacher ` を開ける
- マイク permission が native project 側でも適切に宣言される
- 開発者がローカルで iOS / Android build を試せる
