# route performance budget と計測 harness を Dashboard / Students / Logs / Reports に広げる

## 状態

- Active
- GitHub Issue: `#56`
- 最終更新: `2026-04-13`

## 何を直すか

projection query と UI 共通化で初速は改善したが、一覧導線の perf regression を継続的に止める仕組みはまだ弱い。

## この issue でやること

- Dashboard / Students / Logs / Reports の route ごとに perf budget を決める
- navigation / loading / empty / populated の代表ケースを計測する harness を足す
- 変更前後を比較しやすい出力にする

## ねらい

- 世界水準の SaaS として遅さを数値で管理する
- 体感速度の悪化を再発させにくくする
- 最適化の優先順位を曖昧にしない

## 完了条件

- 一覧導線の遅さを route 単位で追える
- perf regression を再現しやすい
- `npm run typecheck`
- `npm run build`
- 計測スクリプトが通る
