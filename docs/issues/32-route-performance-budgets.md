# route performance budget と計測 harness を Dashboard / Students / Logs / Reports に広げる

## 状態

- 実装済み
- GitHub Issue: `#56`
- 最終更新: `2026-04-13`

## 何を直すか

projection query と UI 共通化で初速は改善したが、一覧導線の perf regression を継続的に止める仕組みはまだ弱かったため、route ごとの budget と比較しやすい harness を追加した。

## この issue でやること

- Dashboard / Students / Logs / Reports の route ごとに target / hard budget を持つ
- navigation / loading / empty / populated の代表ケースを 1 本の harness で計測する
- baseline JSON と Markdown report を同時に出して、比較しやすくする
- Students の empty search, Logs の empty student, Reports の empty filter を回帰しやすくする

## ねらい

- 世界水準の SaaS として遅さを数値で管理する
- 体感速度の悪化を再発させにくくする
- 最適化の優先順位を曖昧にしない

## いま入っている budget

| scenario | target | hard |
| --- | --- | --- |
| dashboard populated | 2500ms | 5000ms |
| students populated | 3000ms | 6000ms |
| students empty search | 900ms | 1800ms |
| logs populated | 3200ms | 6500ms |
| logs empty student | 2400ms | 5000ms |
| reports populated | 3400ms | 7000ms |
| reports empty filter | 2200ms | 5000ms |

## harness の出力

- `login page`, `auth api`, `dashboard` を先に数値化する
- 各 route は `loading shell`, `ready`, `interaction` を分けて記録する
- current / baseline / delta / budget status を Markdown の表で並べる
- `--baseline` を渡すと比較できる
- `--write-baseline` で確認済みの結果を baseline JSON として保存できる

## 完了条件

- 一覧導線の遅さを route 単位で追える
- perf regression を再現しやすい
- `npm run typecheck`
- `npm run build`
- 計測スクリプトが通る

## 確認コマンド

```bash
npm run test:route-performance -- --label local
```
