# 直近で切る Issue 一覧

更新日: 2026-04-19

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

- `#79` ログ生成を protected critical path として repo で守る
- `#80` 録音ロックから次回の面談メモまでの critical path smoke を CI で止める
- `#81` backend/perf ブランチで UI 変更を止める path guard を入れる
- `#82` 主経路の失敗を stage / operationId 付きで可視化する
- `#83` audit などの非本質 side effect を main flow から切り離す
- `#86` 本番データ整合性を read-only audit と fixture isolation で守る
- `#87` 生徒一覧から生徒情報編集へ直接入れる導線を追加する

今回追加した issue docs:

1. [37-student-detail-summary-first-lazy-sections.md](./37-student-detail-summary-first-lazy-sections.md)
2. [38-reports-summary-first-pagination-trace-defer.md](./38-reports-summary-first-pagination-trace-defer.md)
3. [39-upgrade-next-to-active-lts.md](./39-upgrade-next-to-active-lts.md)
4. [40-rum-and-tighter-budgets.md](./40-rum-and-tighter-budgets.md)

今回完了した追加 issue:

1. `#46` Dashboard / Students 一覧の projection query を分けて初回表示を軽くする
2. `#47` StudentSessionConsole を recording / lock / progress hooks に分割する
3. `#48` StudentDetailPageClient を URL sync / overlay / selection hooks に分割する
4. `#49` conversationJobs を orchestration / repository / side effects に分割する
5. `#50` sessionPartJobs を stage handler ごとに分割する
6. `#51` conversation generate pipeline を prompt / normalize / render に分割する
7. `#52` session-progress を状態遷移表と文言レジストリに置き換える
8. `#53` STT runtime を worker pool / chunking policy / IO で分割する
9. `#54` app/api/sessions/[id]/parts を ingest / validation / job dispatch に分割する
10. `#55` Students / Dashboard / Logs / Reports の一覧・状態 UI を共通 primitive 化する
11. `#56` route performance budget と計測 harness を Dashboard / Students / Logs / Reports に広げる
12. `#59` LogView / ReportStudio を section + action hook に分割する
13. `#57` StudentSessionConsole を recording / upload / lock / progress sections に再分割する
14. `#58` conversation-artifact を schema / render / trace helpers に分割する
15. `#60` parent report / next meeting memo 生成基盤を shared helper に寄せて重複を減らす
16. `#64` RUM と tighter budget を入れて世界水準の UX を field で監視する: 実装済み
17. `#61` Student Detail を summary-first + lazy sections にして重い client 導線を分離する: 実装済み
18. `#62` Reports 一覧を summary-first / pagination / source trace defer で軽くする: 実装済み
19. `#63` Next.js を Active LTS に上げて App Router の最新 perf 基盤に乗せる: 実装済み

active に残す基準:

- 現行の主導線を直接よくする
- 既にある backend / data の価値を UI で回収する
- 速度か保守性の debt を実際に減らす

close / defer に回した考え方:

- 大きすぎる umbrella issue は、具体 issue に分けられた時点で閉じる
- Campus / LINE / digest のような拡張候補は active open に置かない
- 今すぐ触らない運用 / 管理機能は、必要になるまで reopen 前提で閉じる

今回追加して完了した生成保全 issue:

1. `#147` 再生成の途中失敗で、既存の面談ログを消さない
2. `#148` finalize 成功後に、後続処理の失敗で面談ログの状態を壊さない
3. `#149` 保護者レポート生成で、壊れた面談ログを markdown fallback で通さない
4. `#150` 面談ログと保護者レポートの保全チェックを verify と CI の必須ゲートに入れる

今回追加した issue docs:

1. [70-regenerate-keep-last-good-log.md](./70-regenerate-keep-last-good-log.md)
2. [71-finalize-main-flow-and-side-effects.md](./71-finalize-main-flow-and-side-effects.md)
3. [72-parent-report-requires-valid-artifact.md](./72-parent-report-requires-valid-artifact.md)
4. [73-protected-generation-gates.md](./73-protected-generation-gates.md)

補足:

- このディレクトリの Markdown は GitHub Issue の本文更新にも使う
- `#38` と `#40` は `2026-04-13` 時点で main に反映済み
- `#13` は backlog 整理の役割を終えたため close 済み

今回追加して完了した Runpod / generation issue:

1. `#152` Runpod + faster-whisper の STT latency を VAD と phase 計測で詰める
2. `#153` progress / log polling を read-only に寄せ、手入力 transcript を one-shot で進める
3. `#154` ログ生成 retry と next meeting memo を prompt cache 前提で安定させる
4. `#155` duplicate enqueue でも active job と last good artifact を壊さない
5. `#156` Runpod UX 計測を p50 / p95 / cost までまとめて見えるようにする

今回追加した issue docs:

1. [74-runpod-stt-latency-and-vad-tuning.md](./74-runpod-stt-latency-and-vad-tuning.md)
2. [75-progress-readonly-polling-and-manual-transcript-start.md](./75-progress-readonly-polling-and-manual-transcript-start.md)
3. [76-stable-prompt-cache-and-memo-roundtrip.md](./76-stable-prompt-cache-and-memo-roundtrip.md)
4. [77-preserve-active-jobs-and-last-good-artifacts.md](./77-preserve-active-jobs-and-last-good-artifacts.md)
5. [78-runpod-ux-percentiles-and-cost-summary.md](./78-runpod-ux-percentiles-and-cost-summary.md)

今回追加した親 issue doc:

1. [79-interview-log-one-minute-parent-plan.md](./79-interview-log-one-minute-parent-plan.md)

今回完了した親 issue:

1. `#151` 面談ログ生成を本番で 1 分台に近づける全体計画を作る

今回追加した改善 issue docs:

1. `#159` [80-post-stt-handoff-and-queue-lag.md](./80-post-stt-handoff-and-queue-lag.md)
2. `#158` [81-runpod-worker-observability-parity.md](./81-runpod-worker-observability-parity.md)
3. `#157` [82-production-prompt-cache-recovery.md](./82-production-prompt-cache-recovery.md)

Teacher App 仕様の新規 issue docs:

1. `#164` [83-teacher-app-recording-mobile-parent-plan.md](./83-teacher-app-recording-mobile-parent-plan.md)
2. `#161` [84-teacher-app-foundation-and-device-auth.md](./84-teacher-app-foundation-and-device-auth.md)
3. `#160` [85-teacher-app-recording-flow-and-temporary-session.md](./85-teacher-app-recording-flow-and-temporary-session.md)
4. `#162` [86-teacher-app-student-suggestion-and-finalize-gate.md](./86-teacher-app-student-suggestion-and-finalize-gate.md)
5. `#163` [87-teacher-app-unsent-queue-and-recovery.md](./87-teacher-app-unsent-queue-and-recovery.md)
6. `#169` [88-teacher-app-ios-android-capacitor-parent-plan.md](./88-teacher-app-ios-android-capacitor-parent-plan.md)
7. `#168` [89-teacher-app-mobile-shell-hardening.md](./89-teacher-app-mobile-shell-hardening.md) - Closed
8. `#166` [90-teacher-app-capacitor-wrapper-and-native-permissions.md](./90-teacher-app-capacitor-wrapper-and-native-permissions.md) - Closed
9. `#165` [91-teacher-app-mobile-recording-lifecycle-hardening.md](./91-teacher-app-mobile-recording-lifecycle-hardening.md)
10. `#167` [92-teacher-app-internal-distribution-and-device-qa.md](./92-teacher-app-internal-distribution-and-device-qa.md)
