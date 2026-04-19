# Teacher App を iOS / Android app として使える形に進める

## 状態

- Closed
- GitHub Issue: `#169`
- 最終更新: `2026-04-19`

## 結論

この方針は採用しない。  
Teacher 録音 app は `web を包む` のではなく、**完全ネイティブ**で進めることに切り替えた。

後継の親 issue は `93` 系の native-first 計画へ移す。

## 先に結論

最短ルートは React Native / Expo への作り直しではない。  
既存の Next.js ` /teacher ` 導線と backend をそのまま使い、**Capacitor で iOS / Android のネイティブ shell を作る**。

最初の到達点は次の 3 つ。

1. iPhone / Android で Teacher App を app icon から開ける
2. 先生が app 内で録音し、既存 `/teacher` main flow を最後まで通せる
3. 内部配布で現場 QA を回せる

## 今回やること

- Teacher App の mobile shell を app 前提で整える
- Capacitor で iOS / Android host app を追加する
- 録音中の background / foreground / permission / retry の mobile 特有の不安定さを潰す
- TestFlight / Play Internal Testing で内部配布できる状態にする

## やらないこと

- React Native / Expo への全面移植
- backend の作り直し
- offline-first 化
- App Store / Google Play 公開リリースの審査対応を最初の close 条件に含めること

## 実装順

- `#168` / `89` Teacher App の mobile shell を app 前提で整える
- `#166` / `90` Capacitor で iOS / Android host app を作る
- `#165` / `91` mobile 録音 lifecycle を harden する
- `#167` / `92` 内部配布と実機 QA を回せるようにする

## 完了条件

- ` /teacher ` を iOS / Android app shell から開ける
- マイク権限、端末ログイン、録音、未送信再送が app 内で通る
- background / foreground をまたいでも main flow が壊れにくい
- TestFlight / Play Internal Testing で内部配布できる
- 現場向けのセットアップ手順と QA チェックリストが揃う
