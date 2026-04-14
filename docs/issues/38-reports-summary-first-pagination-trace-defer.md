# Reports 一覧を summary-first / pagination / source trace defer で軽くする

## 状態

- 実装済み
- GitHub Issue: `#62`
- 最終更新: `2026-04-13`

## 目的

`/app/reports` を「全部見せる画面」ではなく「判断を始める画面」に寄せる。

## いまの課題

- 一覧で `limit: 200` を前提にしている
- source trace 詳細が hot path に乗っている
- queue / delayed / list の責務が少し重なっている

## この issue でやること

- 一覧の projection をさらに絞る
- source trace 詳細を後段表示へ逃がす
- pagination か段階表示を入れる
- reports populated / empty の速さを維持しつつ体感を軽くする

## 今回入れた内容

- `app/app/reports/page.tsx` を shell-first に寄せ、一覧本体を `ReportsDashboardContent` へ分離した
- 一覧の page size を `18` に落とし、段階表示で最初に必要な量だけ描画する形にした
- `lib/students/student-row-query.ts` の report projection を絞り、一覧判断に不要な profile 系 select を hot path から外した
- `report-dashboard.ts` で source trace 詳細をカード直下から外し、一覧の描画負荷を下げた

## 確認

- production 計測で `reports populated: 452ms`
- production 計測で `reports empty filter: 249ms`
- `npm run typecheck`
- `npm run build`
- route perf の tighter budget を通過

## 完了条件

- 一覧の判断に不要な情報を hot path から外せている
- source trace 詳細は必要時だけ読む
- `npm run typecheck`
- `npm run build`
- route perf が通る
