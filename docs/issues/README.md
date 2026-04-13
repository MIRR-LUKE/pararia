# 直近で切る Issue 一覧

更新日: 2026-04-13

今回の前提:

- 今回は UI を実装しない
- raw transcript は壊さない
- reviewed transcript があれば後段で優先し、なければ raw を使う
- 固有名詞だけは候補推測してよいが、自動確定しない
- ログ生成は「きれいな言い換え」より「根拠がある教務ログ」を優先する
- 既存 Issue `#14`〜`#19` の runtime 分離 / pipeline 分割 / artifactJson / jobs 強化 / retention は壊さない

実装済みの直近 5 本:

1. [07-raw-transcript-integrity.md](./07-raw-transcript-integrity.md)
2. [08-proper-noun-suggestions-backend.md](./08-proper-noun-suggestions-backend.md)
3. [09-evidence-grounded-log-generation.md](./09-evidence-grounded-log-generation.md)
4. [10-backend-review-required-judgement.md](./10-backend-review-required-judgement.md)
5. [11-eval-faithfulness-and-proper-nouns.md](./11-eval-faithfulness-and-proper-nouns.md)

今回実装した 9 本:

1. [12-keep-raw-transcript-truly-raw.md](./12-keep-raw-transcript-truly-raw.md)
2. [13-separate-internal-and-provider-glossary.md](./13-separate-internal-and-provider-glossary.md)
3. [14-split-transcript-review-logic.md](./14-split-transcript-review-logic.md)
4. [15-separate-review-read-and-write-api.md](./15-separate-review-read-and-write-api.md)
5. [16-unify-grounded-generation-policy.md](./16-unify-grounded-generation-policy.md)
6. [17-review-state-source-of-truth.md](./17-review-state-source-of-truth.md)
7. [18-separate-operational-summary-and-next-checks.md](./18-separate-operational-summary-and-next-checks.md)
8. [19-make-faithfulness-eval-a-ci-gate.md](./19-make-faithfulness-eval-a-ci-gate.md)
9. [20-clarify-transcript-naming.md](./20-clarify-transcript-naming.md)

直近の追加仕上げ:

- ログ生成の主経路を `structured artifact を 1 回で作る` 形へ寄せた
- `summaryMarkdown` は artifact から render する派生物に固定した
- deterministic recovery は最後の保険だけにして、fallback 前提の流れをやめた
- `test:conversation-draft-quality` を追加して、長文コピペ型の弱い出力を回帰テストで止めるようにした

今回の実装順:

1. 生文字起こしを本当にそのまま残すようにする
2. 固有名詞の辞書を「内部用」と「外部 STT に渡す用」に分ける
3. 固有名詞レビューのロジックを小さく分けて読みやすくする
4. review API を「読む」と「変える」で正しく分ける
5. ログ生成の考え方を 1 本にそろえる
6. review 状態の正本を 1 つに決める
7. 運用ログ向けの要約を、報告用アクションと分けて整理する
8. faithfulness テストを CI の品質ゲートにする
9. transcript 周りの命名を整理して、見ただけで意味が分かるようにする

実装済み 5 本の順番:

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

今回実装した Issue:

- `#25` 生文字起こしを本当にそのまま残すようにする: 実装済み
- `#26` 固有名詞の辞書を「内部用」と「外部 STT に渡す用」に分ける: 実装済み
- `#27` 固有名詞レビューのロジックを小さく分けて読みやすくする: 実装済み
- `#28` review API を「読む」と「変える」で正しく分ける: 実装済み
- `#29` ログ生成の考え方を 1 本にそろえる: 実装済み
- `#30` review 状態の正本を 1 つに決める: 実装済み
- `#31` 運用ログ向けの要約を、報告用アクションと分けて整理する: 実装済み
- `#32` faithfulness テストを CI の品質ゲートにする: 実装済み
- `#33` transcript 周りの命名を整理して、見ただけで意味が分かるようにする: 実装済み

今回の最終調整メモ:

- `#18` と `#22` と `#29` は、artifact 先行生成に合わせて本文も更新した
- `#32` は `test:conversation-draft-quality` と CI 実行内容まで最新化した

今回完了した追加 issue:

1. `#34` UI: 文字起こし確認画面を作る
2. `#35` UI: ログ確認画面を、信頼できるか判断できる画面に作り直す
3. `#36` UI: 生徒詳細に「要確認」の導線を足す
4. `#41` UI: ログ一覧とレポート一覧を、もっと見やすく整理する
5. `#42` UI: エラー・空状態・生成中状態の表示を全部そろえる
6. `#44` Student Detail を server-first / no double fetch で速くする
7. `#45` コード形状ガードと分割ルールを repo に定着させる
8. `#3` 共有状態と送信履歴を Student Room で追えるようにする

次の active open issue:

1. `#48` StudentDetailPageClient を URL sync / overlay / selection hooks に分割する
2. `#49` conversationJobs を orchestration / repository / side effects に分割する
3. `#50` sessionPartJobs を stage handler ごとに分割する
4. `#51` conversation generate pipeline を prompt / normalize / render に分割する
5. `#52` session-progress を状態遷移表と文言レジストリに置き換える
6. `#53` STT runtime を worker pool / chunking policy / IO で分割する
7. `#55` Students / Dashboard / Logs / Reports の一覧・状態 UI を共通 primitive 化する

今回完了した追加 issue:

1. `#46` Dashboard / Students 一覧の projection query を分けて初回表示を軽くする
2. `#47` StudentSessionConsole を recording / lock / progress hooks に分割する
3. `#54` app/api/sessions/[id]/parts を ingest / validation / job dispatch に分割する

active に残す基準:

- 現行の主導線を直接よくする
- 既にある backend / data の価値を UI で回収する
- 速度か保守性の debt を実際に減らす

close / defer に回した考え方:

- 大きすぎる umbrella issue は、具体 issue に分けられた時点で閉じる
- Campus / LINE / digest のような拡張候補は active open に置かない
- 今すぐ触らない運用 / 管理機能は、必要になるまで reopen 前提で閉じる

補足:

- このディレクトリの Markdown は GitHub Issue の本文更新にも使う
- `#38` と `#40` は `2026-04-13` 時点で main に反映済み
- `#13` は backlog 整理の役割を終えたため close 済み
