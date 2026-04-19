# Teacher App の mobile shell を app 前提で整える

## 状態

- Closed
- GitHub Issue: `#168`
- 最終更新: `2026-04-19`

## 目的

既存の ` /teacher ` を、単なる mobile web ではなく **iOS / Android の app shell に乗せても破綻しにくい画面** に整える。  
Capacitor 導入前に、viewport、safe-area、permission denied、unsupported browser などの土台をそろえる。

## 親 issue

- `#169` / `88` Teacher App を iOS / Android app として使える形に進める

## この issue でやること

- ` /teacher ` の layout を safe-area 前提で見直す
- standalone / fullscreen 前提の metadata, manifest, app icon, theme color を整える
- `MediaRecorder` / `getUserMedia` 非対応時の fallback state を明示する
- マイク permission denied 時の表示を app 向けに整理する
- app shell 内で不要な browser 前提 UI を減らす
- Teacher App の entry を `待機画面に最短で入る` ことへ寄せる

## 実装メモ

- PWA を最終目標にはしないが、manifest や metadata は Capacitor shell にも使えるので先に整える
- 画面責務は増やさず、既存 `screen / hook / container` 境界を壊さない
- ここでは native project はまだ作らない

## 実装したこと

- `app/manifest.ts` を追加して、`/teacher` start URL の standalone manifest を入れた
- `app/icon.tsx` と `app/apple-icon.tsx` を追加して app icon metadata route を用意した
- root metadata に `manifest`, `appleWebApp`, `viewportFit`, `themeColor` を追加した
- Teacher App route metadata を追加して app shell 向けの title / description を分けた
- safe-area CSS 変数と `100dvh` レイアウトを入れて、standalone 表示で崩れにくくした
- standby 画面に録音 readiness と permission / unsupported explanation card を追加した
- `useTeacherFlowController` に microphone support detection と開始失敗文言の正規化を入れた
- `manifest`, `icon`, `apple-icon` を basic auth から除外して app shell で取りやすくした

## 確認

- `npm run typecheck`

## 完了条件

- iPhone / Android の縦画面で ` /teacher ` が safe-area を含めて崩れない
- マイク非対応 / 権限拒否 / unsupported codec で先生が詰まりにくい
- app shell で不要な web 感が減っている
- 後続の Capacitor wrapper が乗せやすい metadata が揃う
