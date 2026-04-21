# 面談ログと保護者レポートの保全チェックを verify と CI の必須ゲートに入れる

## 状態

- 実装済み
- GitHub Issue: `#150`
- 最終更新: `2026-04-21`

## 何がつらかったか

- いまも個別テストはあるが、普段の `verify` では生成の中核が毎回は走っていない
- そのため、別の改修で生成まわりを壊しても、気づくのが遅れることがある
- 生成はデバッグ単価が高いので、最後に気づく形をやめたい

## 目標

- 面談ログと保護者レポートの保全チェックを、日常の確認と CI の両方で落とせるようにする
- 重すぎる確認は CI に回しつつ、ローカルでも最低限の危険を止める
- 「守るべき導線」が package script と README で明文化されている状態にする

## やること

- `verify` に入れるべき生成系テストを追加する
- CI workflow に面談ログ / 保護者レポートの回帰テストを入れる
- README の確認手順を更新する
- どのテストが「生成の保全用」か一目で分かるようにする

## 完了条件

- `verify` で生成まわりの主要回帰を落とせる
- CI でも同じ保全チェックが走る
- README に分かりやすく書かれている

## 今回入ったもの

- `package.json` の `verify` に `npm run test:generation-preservation` を入れた
- `Conversation Quality` workflow で同じ `npm run test:generation-preservation` を回すようにした
- README に `generation-preservation` を生成保全の主ゲートとして追記した

## ここでは扱わない残り

- `面談ログ -> generate-report -> 保存済みレポート取得` の E2E smoke は別 issue で扱う
- route の protected critical path (`録音ロック -> student room -> next meeting memo`) も別 issue で扱う
