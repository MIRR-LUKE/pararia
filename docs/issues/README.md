# 直近で切る Issue 一覧

更新日: 2026-03-27

今回の前提:

- 今回は UI を実装しない
- raw transcript は壊さない
- reviewed transcript があれば後段で優先し、なければ raw を使う
- 固有名詞だけは候補推測してよいが、自動確定しない
- ログ生成は「きれいな言い換え」より「根拠がある教務ログ」を優先する
- 既存 Issue `#14`〜`#19` の runtime 分離 / pipeline 分割 / artifactJson / jobs 強化 / retention は壊さない

今回切る 5 本:

1. [07-raw-transcript-integrity.md](./07-raw-transcript-integrity.md)
2. [08-proper-noun-suggestions-backend.md](./08-proper-noun-suggestions-backend.md)
3. [09-evidence-grounded-log-generation.md](./09-evidence-grounded-log-generation.md)
4. [10-backend-review-required-judgement.md](./10-backend-review-required-judgement.md)
5. [11-eval-faithfulness-and-proper-nouns.md](./11-eval-faithfulness-and-proper-nouns.md)

実装順:

1. 生文字起こしを壊さない
2. proper noun suggestion backend
3. reviewed transcript を後段で使えるようにする
4. evidence-grounded なログ生成へ変更
5. fallback を保守化
6. reviewRequired 判定
7. eval 強化

既存の土台:

- [01-runtime-data-boundary.md](./01-runtime-data-boundary.md)
- [02-split-conversation-pipeline.md](./02-split-conversation-pipeline.md)
- [03-generation-evaluation-harness.md](./03-generation-evaluation-harness.md)
- [04-harden-conversation-jobs.md](./04-harden-conversation-jobs.md)
- [05-structured-artifact-source-of-truth.md](./05-structured-artifact-source-of-truth.md)
- [06-deletion-and-retention-policy.md](./06-deletion-and-retention-policy.md)

既存 Issue の状態:

- `#14` 音声や一時ファイルを Git に入らないようにする: 実装済み
- `#15` 会話ログを作る処理を、役割ごとに分けてわかりやすくする: 実装済み
- `#16` 会話ログの出来を、毎回同じサンプルで確認できるようにする: 実装済み
- `#17` 会話ログのジョブを、失敗や二重実行に強くする: 実装済み
- `#18` 会話ログの正本データを 1 つに決める: 実装済み
- `#19` 削除ルールと保存期間のルールをはっきり決める: 実装済み

今回追加した Issue:

- `#20` 生文字起こしを壊さず raw / reviewed / display transcript を分離する: 実装済み
- `#21` 固有名詞候補推測と reviewed transcript を backend 側に入れる: 実装済み
- `#22` ログ生成を evidence-grounded に変えて、fallback でも盛らないようにする: 実装済み
- `#23` reviewRequired を backend 側だけで判定できるようにする: 実装済み
- `#24` eval で「盛り」と「固有名詞崩れ」を検知できるようにする: 実装済み

補足:

- このディレクトリの Markdown は、GitHub Issue の本文更新にも使う
- 今回の 5 本は「まず backend を固める」ための issue で、完成 UI はスコープ外
- glossary 管理画面や Student Room の最終 UI は今回の issue には含めない

このディレクトリの Markdown は、GitHub Issue の本文更新にも使えるように、実装状況と確認内容まで含めて整理しています。
