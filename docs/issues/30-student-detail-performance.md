# Student Detail を server-first / no double fetch で速くする

## 状態

- 実装済み
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

## 今回追加で入れたこと

- `StudentDetailActionQueue` と `studentDetailFormatting` に責務を逃がして、主画面の再描画範囲を狭めた
- 指導報告タブと送付履歴タイムラインを足して、同じ画面の中で戻り作業を減らした
- `scripts/test-navigation-performance.ts` で再計測し、`studentDetailNavMs=5748` / console error `0` を確認した

## 完了条件

- 生徒詳細遷移で二重ローディング感がない
- 主要カードが不要な親 render に巻き込まれにくい
- navigation performance を継続計測できる

## 確認

- `npm run typecheck`
- `npm run build`
- `npx tsx scripts/test-navigation-performance.ts --label after-student-detail`
