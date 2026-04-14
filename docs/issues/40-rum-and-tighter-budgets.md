# RUM と tighter budget を入れて世界水準の UX を field で監視する

## 状態

- 実装済み
- GitHub Issue: `#64`
- 最終更新: `2026-04-13`

## 目的

ローカルの lab 計測だけでなく、実ユーザーの field data で UX を監視できるようにする。

## この issue でやること

- Web Vitals / route timings の軽い計測基盤を入れる
- 集計しやすいイベント形式を決める
- 既存 budget を tighter に見直す
- docs に読み方と運用を残す

## いま入っている実装

- root `instrumentation.ts` で server boot 時の observability config を初期化した
- `app/layout.tsx` に client 側の telemetry bridge を差し込んだ
- `POST /api/rum` で Web Vitals と route timing を受けられるようにした
- [performance-observability.md](../performance-observability.md) に event 形式と budget をまとめた

## 最終確認

- `npm run test:navigation-performance -- --label prod-world-ux-final --base-url http://127.0.0.1:3021`
- 結果は `.tmp/navigation-performance-prod-world-ux-final.md`
- `dashboard 246ms / students 232ms / logs 278ms / reports 452ms`
- console error `0`
- over target budget `0`

## 完了条件

- 実ユーザー計測を送れる
- 予算超過を継続的に見つけられる
- docs から運用方法が分かる
