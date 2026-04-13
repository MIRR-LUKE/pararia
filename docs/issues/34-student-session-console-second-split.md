# StudentSessionConsole を recording / upload / lock / progress sections に再分割する

## 状態

- 実装済み
- GitHub Issue: `#57`
- 最終更新: `2026-04-13`

## 何を直すか

`StudentSessionConsole.tsx` は録音 UI、upload action、lock 制御、進捗監視、操作ボタン群がまだ密集している。

## この issue でやること

- recording transport を独立させる
- upload action を分離する
- lock / progress polling を独立 hook に寄せる
- section ごとの UI を presentation component に逃がす

## ねらい

- 体感の引っかかりを減らす
- state 更新の波及を狭める
- repo 最大級の UI debt を減らす

## 完了条件

- `StudentSessionConsole.tsx` が controller に近い薄さまで下がる
- 録音系 state の責務境界が見ただけで分かる
- `npm run typecheck`
- `npm run build`
- `npm run check:code-shape`
