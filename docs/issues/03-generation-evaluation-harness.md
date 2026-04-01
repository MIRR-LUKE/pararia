# 会話ログの出来を、毎回同じサンプルで確認できるようにする

## 状態

- 実装済み
- GitHub Issue: `#16`
- 最終更新: `2026-03-26`
- 最新補足: `session progress` / `STT fallback` / `audio upload support` の回帰チェックも追加済み

## 何をするか

固定のサンプル会話を使って、会話ログの出力が良くなったか悪くなったかを比べられる仕組みを作る。

## なぜやるか

今は「なんとなく良さそう」で判断しやすく、改善したつもりで別の出力を壊してしまう危険がある。

Pararia では見るべき点が多い。

- 事実が合っているか
- 生徒の変化が読めるか
- 次の行動が自然か
- 面談ログとして読めるか
- 指導報告として使えるか

これを毎回手作業だけで見るのはつらい。

## やること

- 固定の transcript サンプルを用意する
- 面談用と指導報告用で別々に評価できるようにする
- 比較用の script を作る
- 出力結果を保存して diff しやすくする
- 人が見るための簡単な評価基準を決める

## 終わったといえる状態

- [x] 同じ入力で毎回比較できる
- [x] 面談ログと指導報告ログを分けて確認できる
- [x] prompt や整形を直したあとに差分確認ができる
- [x] 回帰チェックの土台として使える

## 今回入れたもの

- `fixtures/conversation-eval/` に固定ケースと rubric を追加した
- `scripts/test-conversation-eval.ts` で出力比較とレポート出力をできるようにした
- `.tmp/conversation-eval-report.md` に結果を保存できるようにした

## 確認

- `npm run test:audio-upload-support`
- `npm run test:conversation-eval -- --out .tmp/conversation-eval-report.md`
- `npm run test:session-progress`
- `npm run test:local-stt`
- 現在の固定 2 ケースは `2/2 PASS`

## ラベル

- `ai`
- `quality`
- `tooling`
- `priority:high`
