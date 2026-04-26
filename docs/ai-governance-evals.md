# STT / LLM AI ガバナンス・評価

最終更新: 2026-04-25

## 1. 目的

PARARIA SaaS の AI 機能は、講師の面談音声を文字起こしし、面談ログ・保護者向け帳票へ変換します。この文書は、STT と LLM の品質、安全性、変更統制、証跡を定義します。教育領域の日本語データを扱うため、便利さよりも事実性、固有名詞、説明可能性、個人情報保護を優先します。

関連文書:

- `docs/conversation-eval-harness.md`
- `docs/runpod-worker.md`
- `docs/production-slo-runbooks.md`
- `docs/release-governance.md`

## 2. AI システム境界

| stage | 担当 | 正本 | 主なリスク |
| --- | --- | --- | --- |
| 音声 upload | Web / Blob | Vercel Blob object | 欠落、重複、権限不備 |
| STT | Runpod worker / faster-whisper | raw transcript | 聞き間違い、話者混同、GPU runtime 差分 |
| transcript review | Web | review state | raw transcript の破壊、修正履歴欠落 |
| LLM 生成 | Web-side finalize | conversation artifact | 幻覚、固有名詞誤り、禁止表現 |
| report delivery | Web | report artifact / delivery event | 未確認 artifact の配信 |

`docs/runpod-worker.md` の通り、Runpod worker は STT-only を原則とし、LLM finalize は web 側で実行します。

## 3. ガバナンス原則

- raw transcript は正本として保持し、生成都合で上書きしない。
- LLM 生成物は「提案」であり、review gate を通って初めて顧客向け利用可能にする。
- last good artifact を保持し、再生成失敗時に既存の良品を壊さない。
- model、prompt、runtime image、env、git SHA を追跡できるようにする。
- provider 変更、model 変更、prompt 変更、STT parameter 変更は release 変更として扱う。
- 個人情報や学習記録を eval report に残す場合は、社内限定の保管場所に置き、公開 artifact に含めない。

## 4. 評価軸

### 4.1 STT

| 軸 | 合格基準 | 確認方法 |
| --- | --- | --- |
| 日本語聞き取り | 受験、教科、講師用語の意味が崩れない | benchmark transcript の目視差分 |
| 固有名詞 | 生徒名、学校名、教材名を不自然に置換しない | glossary / transcript review |
| 欠落 | 長い沈黙や話者交代で重要発話を落とさない | raw audio と transcript spot check |
| runtime 再現性 | image / git SHA / runtime revision が追跡できる | Runpod heartbeat、qualityMetaJson |
| latency | SLO の STT job p95 を満たす | Runpod UX summary |

関連コマンド:

```bash
npm run test:runpod-only-stt
npm run test:runpod-remote-stt-completion
npm run runpod:measure-summary -- --dir .tmp/runpod-ux --out .tmp/runpod-ux-summary.md
```

### 4.2 LLM 生成

| 軸 | 合格基準 | 確認方法 |
| --- | --- | --- |
| 事実性 | transcript にない断定をしない | `test:conversation-eval`、review |
| 構造 | 必須見出し、面談ログの体裁を満たす | rubric |
| 固有名詞 | 生徒名、講師名、学校名、科目を誤変換しない | rubric / review |
| 禁止表現 | 不適切な評価、断定的診断、過度な不安喚起を避ける | rubric |
| 保護者向け表現 | 日本語として自然で、次回行動が具体的 | reviewer checklist |
| 再生成安全性 | 失敗時に last good artifact を保持する | `test:generation-preservation` |

関連コマンド:

```bash
npm run test:conversation-eval
npm run test:conversation-eval -- --out .tmp/conversation-eval-report.md
npm run test:generation-preservation
npm run test:conversation-draft-quality
npm run test:parent-report-generation
```

## 5. 評価ハーネス

`docs/conversation-eval-harness.md` の通り、固定サンプルは `fixtures/conversation-eval/cases.json`、rubric は `fixtures/conversation-eval/rubric.json` に置きます。

運用ルール:

- main へ入れる前に `Conversation Quality` workflow を通す。
- model / prompt / generation route / artifact schema を変える PR は eval report を添付する。
- 失敗した rubric を「今回は軽微」として通す場合、承認者と理由を PR に記録する。
- 新しい事故や顧客指摘が出た場合、同種の regression case を fixtures に追加する。

GitHub Actions:

- `Conversation Quality`
- `Generation Route Smoke`
- `Critical Path Smoke`

## 6. モデル・プロンプト変更手順

### 6.1 変更種別

| 変更 | リスク | 必須確認 |
| --- | --- | --- |
| STT model / VAD / beam / batch | 高 | STT benchmark、Runpod smoke、latency 比較 |
| LLM model | 高 | eval report、reviewer approval、rollback plan |
| system prompt / rubric | 中から高 | eval report、差分説明 |
| temperature / retry / timeout | 中 | generation preservation、route smoke |
| UI 表示文言のみ | 低 | typecheck、対象 smoke |

### 6.2 手順

1. 変更理由、対象 tenant、期待効果、rollback 方法を PR に書く。
2. `npm run test:conversation-eval -- --out .tmp/conversation-eval-report.md` を実行する。
3. `npm run test:generation-preservation` を実行する。
4. STT を触る場合は `npm run test:runpod-only-stt` と `npm run test:runpod-worker-ready` を実行する。
5. 本番相当で `Production Recording Smoke` を実行する。
6. rollout は小さく始め、SLO と reviewer feedback を確認して広げる。

### 6.3 承認

高リスク変更は二者承認にします。

- 技術承認: owning engineer
- 業務品質承認: 教務責任者または運用責任者

承認時に残す項目:

- model / prompt / worker image / git SHA
- eval report path
- 既知の弱点
- rollback deadline
- 顧客影響の有無

## 7. 本番監視

AI 関連の監視は次を必須にします。

- STT job status、queue lag、p50/p95 latency。
- Runpod heartbeat の `runpodWorkerImage`、`runpodWorkerGitSha`、`runpodWorkerRuntimeRevision`。
- conversation job failure rate、retry count、finalize latency。
- review rejected rate、manual correction rate。
- eval regression の有無。

閾値と severity は `docs/production-slo-runbooks.md` に従います。

## 8. AI Incident Runbook

### 8.1 幻覚・不適切生成

1. 対象 artifact を配信停止または review pending に戻す。
2. raw transcript、reviewed transcript、生成 artifact、model metadata を保全する。
3. `npm run test:conversation-eval -- --out .tmp/conversation-eval-report.md` を実行し、既存 rubric で再現するか確認する。
4. 再現する場合は fixture / rubric を追加し、model / prompt rollback を判断する。
5. 顧客に影響した場合は incident report に対象範囲と再発防止を記載する。

### 8.2 STT 劣化

1. 直近 Runpod image と STT env を確認する。
2. `docs/runpod-worker.md` に従い、直前安定 SHA の worker image へ戻す。
3. 生文字起こし benchmark と本番該当 session を spot check する。
4. VAD / beam / batch の変更が原因なら release を revert し、追加 benchmark を作る。

### 8.3 Provider 障害

1. provider status を確認する。
2. retry で顧客影響が拡大する場合は job 投入を一時停止する。
3. 未完了 job を保全し、復旧後に再実行する。
4. fallback provider を使う場合も model 変更として扱い、eval gate を省略しない。

## 9. 監査証跡

AI 変更ごとに次を残します。

- PR URL、commit SHA、release ID。
- `Conversation Quality` workflow run URL。
- `conversation-eval-report` artifact。
- `Generation Route Smoke` / `Critical Path Smoke` の run URL。
- STT 変更時は `Production Recording Smoke` と Runpod worker image digest。
- reviewer approval と例外承認の理由。

## 10. 禁止事項

- raw transcript を生成結果で上書きする。
- eval が失敗した model 変更を理由なしで本番反映する。
- prompt や model を env だけで本番変更し、PR と証跡を残さない。
- provider 障害時に検証なしで fallback model へ切り替える。
- 個人情報を含む eval artifact を公開 repository や公開 CI log に出す。
