# Student Detail を server-first / no double fetch で速くする

## 状態

- 一部できている
- GitHub Issue: `#44`
- 最終更新: `2026-04-13`

## 何を直すか

`/app/students/[studentId]` の体感を、初回表示から「引っかかりが少ない」状態にする。

## いま重い理由

- summary を見せてから full を取り直す二重取得があった
- 見えている主要 UI が親の細かい state 更新に巻き込まれていた
- room データ取得で直列待ちが残っていた

## 今回入れた内容

- 初期表示を `scope: full` に寄せ、`summary -> full` の二重取得をやめた
- `StudentSessionConsole` と `StudentDetailWorkspace` を memo 化した
- 重い子へ渡す callback を stable にした
- `getStudentRoomData()` の依存取得を一部 `Promise.all` に寄せた
- overlay だけを lazy load に残し、主要導線はそのまま出す形にした

## まだやること

- `StudentDetailPageClient.tsx` を URL sync / overlay / data orchestration に分割する
- `StudentSessionConsole.tsx` を recording / upload / lock / progress polling で分割する
- 実測を複数回取り、平均値で効果を見る

## 完了条件

- 生徒詳細遷移で二重ローディング感がない
- 主要カードが不要な親 render に巻き込まれにくい
- navigation performance を継続計測できる

## 確認

- `npm run typecheck`
- `npm run build`
- `npx tsx scripts/test-navigation-performance.ts --label after-student-detail`
