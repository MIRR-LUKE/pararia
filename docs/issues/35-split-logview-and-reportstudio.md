# LogView / ReportStudio を section + action hook に分割する

## 状態

- Active
- GitHub Issue: `#59`
- 最終更新: `2026-04-13`

## 何を直すか

`LogView.tsx` と `ReportStudio.tsx` は UI と操作ロジックがまだ密で、一覧導線を軽くした後も詳細画面の変更コストが高い。

## この issue でやること

- header / timeline / preview / action を section に分ける
- submit / retry / share / selection を action hook に分ける
- 共通 primitive の再利用余地を広げる

## ねらい

- 見た目変更と操作ロジック変更を切り分ける
- 巨大 TSX を減らす
- 詳細画面の再描画境界も整理する

## 完了条件

- `LogView.tsx` と `ReportStudio.tsx` の責務が section 単位で読める
- action ロジックが hook にまとまる
- `npm run typecheck`
- `npm run build`
- `npm run check:code-shape`
