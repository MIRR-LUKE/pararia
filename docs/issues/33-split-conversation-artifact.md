# conversation-artifact を schema / render / trace helpers に分割する

## 状態

- Active
- GitHub Issue: `#58`
- 最終更新: `2026-04-13`

## 何を直すか

`lib/conversation-artifact.ts` は artifact schema、normalization、render、trace helper が同居していて、変更の影響範囲が広い。

## この issue でやること

- schema / types を分ける
- render 系を分ける
- trace helper / accessor を分ける
- import 面は facade で保つ

## ねらい

- artifact を正本にしたまま変更しやすくする
- render と schema の責務を分ける
- 生成改善の次手を入れやすくする

## 完了条件

- artifact 周辺の責務境界が明確になる
- render 変更が schema へ波及しにくい
- `npm run typecheck`
- `npm run build`
- `npm run check:code-shape`
