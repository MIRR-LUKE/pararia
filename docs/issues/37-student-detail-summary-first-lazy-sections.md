# Student Detail を summary-first + lazy sections にして重い client 導線を分離する

## 状態

- 実装済み
- GitHub Issue: `#61`
- 最終更新: `2026-04-13`

## 目的

`/app/students/[studentId]` の初回表示を summary-first に切り替え、録音・レポート生成・重い workspace は必要時だけ読ませる。

## いまの課題

- 初回 SSR で `scope: "full"` を取っている
- `StudentSessionConsole` と workspace が最初から同じ画面に載っている
- 重い client bundle が生徒詳細の初回導線に乗っている

## この issue でやること

- 初回表示を `summary` データ中心に寄せる
- 重い section を lazy load し、必要時だけ full room を読む
- `StudentSessionConsole` / workspace / overlay の責務をさらに細かくする
- route perf と体感を再計測する

## 今回入れた内容

- `app/app/students/[studentId]/page.tsx` の初回取得を `scope: "summary"` に切り替えた
- `StudentDetailPageClient` で録音パネル / workspace / overlay を dynamic import にし、開くまで読まない形にした
- `useStudentDetailRefresh` で summary 状態のまま開き、重い section を開いた時だけ silent refresh で full room を読むようにした
- `app/api/students/[id]/room/route.ts` と `lib/students/get-student-room.ts` に `summary` / `full` の読み分けを入れた

## 確認

- populated な生徒詳細の初回 summary shell はローカル計測で `448ms`
- 重い workspace を開くまでは full room を待たない
- `npm run typecheck`
- `npm run build`
- route perf の tighter budget を維持

## 完了条件

- 初回表示が「上を見れば判断できる」状態になっている
- 録音や編集を開くまで重い section を待たない
- `npm run typecheck`
- `npm run build`
- navigation / interaction 計測が通る
