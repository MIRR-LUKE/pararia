# parent report / next meeting memo 生成基盤を shared helper に寄せて重複を減らす

## 状態

- Active
- GitHub Issue: `#60`
- 最終更新: `2026-04-13`

## 何を直すか

`lib/ai/parentReport.ts` と `lib/ai/next-meeting-memo.ts` は prompt transport、response unwrap、normalization の似た責務を別々に抱えている。

## この issue でやること

- prompt transport の共有化
- response unwrap / normalization の共有化
- domain 固有の差分だけを各モジュールに残す
- テストの重複も減らす

## ねらい

- 品質改善を二重修正にしない
- 生成基盤の見通しを良くする
- report / memo 両方の変更速度を上げる

## 完了条件

- 共有できる生成 helper が 1 か所にまとまる
- parent report と next meeting memo の責務差分が明確になる
- `npm run typecheck`
- `npm run build`
- `npm run check:code-shape`
