# PARARIA SaaS

PARARIA は、塾・個別指導・学習コーチング向けの `Teaching OS` です。  
現在の実装は、**録音や会話メモから `面談ログ` または `指導報告ログ` を 1 本生成し、その保存済みログを選んで `保護者レポート` を作る** ことに絞っています。

この README は、**2026-03-27 時点の現行コードと一致する運用仕様書** です。

## 1. 先に結論

- 主導線は `Student Room`
- 録音モードは `INTERVIEW` と `LESSON_REPORT` の 2 つ
- 会話ログの正本は `ConversationLog.artifactJson`
- transcript は `raw / reviewed / display` の役割を分ける
- ログ生成は `reviewedText` があればそれを優先し、なければ raw transcript を使う
- 通常生成 / retry / fallback は同じ evidence-first 方針でそろえる
- `reviewState` が transcript review の現在状態を表す正本
- `qualityMetaJson.transcriptReview` は review が必要な理由と件数の説明だけを持つ
- 固有名詞辞書は `内部用` と `外部 STT ヒント用` を分け、provider に送る語は `sendToProvider=true` だけに絞る
- `summaryMarkdown` は画面表示や互換用に保存する派生物
- ログ生成は `ConversationJob.FINALIZE` を中心に動き、失敗時は retry / stale recovery を持つ
- 自動の後段 polish は **ない**
- `保護者レポート` は **選択したログだけ** を使い、`artifactJson` を優先して `summaryMarkdown` で補う
- 未選択ログ、前回レポート、プロフィール snapshot はレポート本文生成に入れない
- faithfulness の代表テストは GitHub Actions の `Conversation Quality` でも回す

## 2. 非交渉の設計原則

### 2.1 Log Only

- 面談モードの成果物は `面談ログ`
- 指導報告モードの成果物は `指導報告ログ`
- どちらも正本は `artifactJson`
- transcript の正本は `rawTextOriginal`
- `reviewedText` は固有名詞候補を反映した確認用 transcript
- `rawTextCleaned` は後方互換のために残している legacy の display / preview transcript
- `summaryMarkdown` は `artifactJson` から render した表示用の派生物
- 補助表示として `formattedTranscript` または raw transcript を持つ
- 旧 `timeline / nextActions / parentPack / profileDelta` を別成果物として増やす構成はやめ、必要な情報は `artifactJson` に集約する

### 2.2 Single Finalize Pass

- ログ本文は `FINALIZE` 1 回で `DONE` にする
- 後段の追加仕上げ job や段階的 finalize は使わない
- `FORMAT` は transcript 表示が必要なときだけ追加する
- 生成途中の「下書き公開 + 裏で最終調整」はしない

### 2.3 Selected Artifact First

- 保護者レポートに入れる材料は選択済みログだけ
- 正本としては各ログの `artifactJson` を使う
- `summaryMarkdown` は文脈確認用の派生物として補助的に使う
- 未選択ログは本文生成に使わない
- 前回レポートの本文は入れない
- 生徒プロフィール snapshot は入れない
- 候補ログ全件の自動束ねはしない

### 2.4 Duration Enforcement On Both Sides

- 面談は `60 分` まで
- 指導報告は `CHECK_IN / CHECK_OUT` の各 part が `10 分` まで
- client 側でも止める
- server 側でも reject する

## 3. 体験の主導線

1. 講師が `Student Room` を開く
2. `面談` か `指導報告` を選ぶ
3. 録音するか、音声ファイルを取り込む
4. 保存 API は **受付だけ即時返す**
5. 裏側で STT と session promotion を進める
6. session が揃ったら `FINALIZE` でログ本文を 1 本生成する
7. 講師は `ログ本文` と `文字起こし` を確認する
8. 必要なログだけを選び、保護者レポートを作る
9. 共有状態を更新する

## 4. 画面の役割

### 4.1 `/app/dashboard`

- 今日優先して動くべき生徒を見る
- `面談を始める` / `授業を始める` に入る
- 面談未実施、チェックアウト待ち、レポート未作成、共有待ちを確認する

### 4.2 `/app/students`

- 生徒検索
- 生徒追加
- Student Room へ移動

### 4.3 `/app/students/[studentId]`

主作業面。

- `StudentSessionConsole`
  - `INTERVIEW`
  - `LESSON_REPORT`
  - `CHECK_IN / CHECK_OUT`
  - 録音開始
  - 音声ファイル取り込み（`.mp3` / `.m4a` のみ）
- `StudentSessionStream`
  - 進行中または完了済みの面談ログを追う
- 指導報告ログ一覧
- 保護者レポート生成カード
- `LogView`
- `ReportStudio`

### 4.4 `/app/logs`

- ログの補助参照面
- `summaryMarkdown` と transcript を確認する
- どのレポートに使われたかを追う

### 4.5 `/app/reports`

- レポート確認の補助面
- 主作業は Student Room に戻す

### 4.6 `/app/settings`

- 運用設定
- guardian 情報の補完確認
- 保存方針の確認

## 5. モード別仕様

### 5.1 面談モード

- `Session.type = INTERVIEW`
- part は `FULL` 1 本
- 最大長は `60 分`
- ready になった transcript をまとめて 1 本の `面談ログ` を作る
- 生成完了後は `ConversationLog.status = DONE`

生成されるもの:

- `artifactJson`
- `summaryMarkdown`
- `rawTextOriginal`
- `reviewedText`
- `rawTextCleaned`
- `rawSegments`
- `reviewState`
- 必要時の `formattedTranscript`
- `qualityMetaJson`

生成しないもの:

- timeline JSON
- next action JSON
- parent pack JSON
- profile delta JSON
- 話題候補タブ向け補助成果物

### 5.2 指導報告モード

- `Session.type = LESSON_REPORT`
- part は `CHECK_IN` と `CHECK_OUT`
- 各 part の最大長は `10 分`
- 両方揃ってから 1 本の `指導報告ログ` を作る
- `CHECK_IN` だけではログ生成しない
- `CHECK_OUT` だけでもログ生成しない

生成されるもの:

- `artifactJson`
- `summaryMarkdown`
- `rawTextOriginal`
- `reviewedText`
- `rawTextCleaned`
- `rawSegments`
- `reviewState`
- 必要時の `formattedTranscript`
- `qualityMetaJson`

生成しないもの:

- lesson report 補助 JSON
- 親共有 pack
- observation JSON
- student state JSON

## 6. 同期 / 非同期の分割

### 6.1 同期でやること

- 認可
- 入力バリデーション
- duration 上限チェック
- SessionPart の保存
- live chunk 保存
- job enqueue
- 進捗 API の返却

### 6.2 非同期でやること

- file upload 後の STT
- live recording finalize
- Session promotion
- transcript 統合
- `FINALIZE`
- 任意の `FORMAT`

## 7. 速度設計

目標:

- 保存受付は数秒以内
- 一般的なケースでは STT 完了後に `20〜60 秒` でログ本文を返せる構成
- 何分もかかる後段 LLM 連鎖を作らない

そのための実装:

- ログ生成は `FINALIZE` の 1 call に寄せる
- hidden な polish を走らせない
- transcript 表示整形は `FORMAT` に分離し、常時実行しない
- file upload は server-side chunking を使う
- ユーザーが選べる音声ファイルは `.mp3` / `.m4a` のみ
- chunking 条件:
  - `75 秒以上` で分割
  - 面談は `60 秒` chunk
  - 指導報告は `45 秒` chunk
  - `最大 8 並列`
- session progress API で UI を早く戻す
- poll で worker を再キックできる

### 7.1 速度を落とすものとして明示的にやめたこと

- analyze -> reduce -> finalize の多段 LLM
- 自動の追加仕上げ job
- 旧 structured artifact の同時生成
- 保護者レポート素材の裏生成
- ログ本体以外の hidden output を同時に作ること

## 8. ジョブ設計

### 8.1 `SessionPartJob`

型:

- `TRANSCRIBE_FILE`
- `FINALIZE_LIVE_PART`
- `PROMOTE_SESSION`

責務:

- 音声を transcript に変える
- live chunk を part に確定する
- session を `ConversationLog` 化できる状態へ進める

### 8.2 `ConversationJob`

型:

- `FINALIZE`
- `FORMAT`

責務:

- `FINALIZE`
  - transcript から `artifactJson` と `summaryMarkdown` を作る
  - 完了時に `ConversationLog.status = DONE`
- `FORMAT`
  - transcript 表示を整形する
  - 本文生成の必須条件ではない

持つ観測情報:

- `executionId`
- `attempts / maxAttempts`
- `nextRetryAt`
- `leaseExpiresAt / lastHeartbeatAt`
- `failedAt / completedAt`
- `lastRunDurationMs / lastQueueLagMs`

補足:

- retryable error は backoff 付きで再試行する
- stale な `RUNNING` job は lease 期限切れで再回収する

## 9. データモデル

### 9.1 中核モデル

- `Student`
- `StudentProfile`
- `Session`
- `SessionPart`
- `SessionPartJob`
- `ConversationLog`
- `ConversationJob`
- `Report`
- `ReportDeliveryEvent`
- `AuditLog`
- `StudentRecordingLock`

### 9.2 `ConversationLog` の現在の意味

- `artifactJson`
  - 会話ログの正本
  - `summary / claims / nextActions / sharePoints / facts / changes / assessment / nextChecks / sections` を持つ
  - 各 entry は `text / evidence / basis / humanCheckNeeded / confidence / claimType / actionType` を持てる
- `summaryMarkdown`
  - `artifactJson` から render される表示用の本文
- `rawTextOriginal`
  - 元 transcript
  - provider の返り値を意味を変えずに保存する evidence の保存先
  - 行末統一と trim 以外の sanitize はしない
- `reviewedText`
  - proper noun suggestion を反映した確認用 transcript
  - ログ生成では `reviewedText` があればこちらを優先する
- `rawTextCleaned`
  - display / preview 用の軽整形 transcript
  - legacy カラムなので evidence path には使わない
- `rawSegments`
  - STT segment
- `reviewState`
  - `NONE / REQUIRED / RESOLVED`
  - transcript review の現在状態を見る正本
- `formattedTranscript`
  - 必要時だけ整形
- `qualityMetaJson`
  - STT 時間、モデル、警告、生成時間、job retry 情報など
  - `transcriptReview` には review 理由、件数、更新時刻だけを入れる

## 10. 保護者レポート

### 10.1 入力ルール

- 選択したログだけを使う
- 本文生成では各ログの `artifactJson` を優先して使う
- `summaryMarkdown` は必要時だけ補助材料として使う
- bundle preview では `今回の判断・補足` と `次回確認` を分けて扱う
- 未選択ログは入れない
- 前回レポートは入れない
- profile snapshot は入れない

### 10.2 UI ルール

- 追加候補は提案だけ
- 自動追加しない
- `Report.sourceLogIds` に利用ログを残す

### 10.3 状態

- `DRAFT`
- `REVIEWED`
- `SENT`

## 11. 録音制約

### 11.1 client 側

- `StudentSessionConsole` が録音秒数上限で停止
- file upload 前に audio metadata を見て長すぎるファイルを reject
- file picker では `.mp3` / `.m4a` 以外を選べない
- 拡張子 / MIME が `.mp3` / `.m4a` に合わないファイルは reject する

### 11.2 server 側

- `POST /api/sessions/[id]/parts`
  - file upload duration を解析して reject
  - `.mp3` / `.m4a` 以外の file upload を reject
- `POST /api/sessions/[id]/parts/live`
  - live chunk 累積 duration を見て reject
- duration 不明なら strict に reject する経路を持つ
- 面談の diarized STT が空で返った場合は、通常 transcription に 1 段フォールバックして救済する

## 12. 進捗表示

### 12.1 session progress の段階

- `IDLE`
- `RECEIVED`
- `TRANSCRIBING`
- `WAITING_COUNTERPART`
- `GENERATING`
- `READY`
- `REJECTED`
- `ERROR`

### 12.2 重要な約束

- 「下書き公開して裏で最終調整」はしない
- `READY` はそのまま確認してよい最終ログ
- `WAITING_COUNTERPART` は lesson report 特有

## 13. API 一覧

### 13.1 認証

- `POST /api/auth/login`
- `GET/POST /api/auth/[...nextauth]`

### 13.2 生徒

- `GET/POST /api/students`
- `GET/PUT /api/students/[id]`
- `GET /api/students/[id]/room`
- `GET/POST/PATCH/DELETE /api/students/[id]/recording-lock`

### 13.3 セッション

- `GET/POST /api/sessions`
- `GET/PATCH /api/sessions/[id]`
- `POST /api/sessions/[id]/parts`
- `POST /api/sessions/[id]/parts/live`
- `GET /api/sessions/[id]/progress`

### 13.4 コミュニケーションログ

- `GET/POST /api/conversations`
- `GET/PATCH/DELETE /api/conversations/[id]`
- `POST /api/conversations/[id]/regenerate`
- `POST /api/conversations/[id]/format`
- `GET/POST /api/conversations/[id]/review`
- `PATCH /api/conversations/[id]/review/suggestions/[suggestionId]`

補足:

- `POST /api/conversations`
  - transcript 直入力を受けて background worker を起動する
- `GET /api/conversations/[id]?brief=1&process=1`
  - 軽量取得 + worker 再キック
- `POST /api/conversations/[id]/regenerate?format=1`
  - 再生成に加えて transcript 整形も再実行
- `GET /api/conversations/[id]/review`
  - raw / reviewed / display transcript と proper noun suggestion を返す
  - 読み取り専用で、副作用は持たない
- `POST /api/conversations/[id]/review`
  - reviewed transcript と suggestion を作り直す
- `PATCH /api/conversations/[id]/review/suggestions/[suggestionId]`
  - `confirmed / rejected / manually_edited` を保存する

### 13.5 保護者レポート

- `POST /api/ai/generate-report`
- `POST /api/reports/[id]/send`

### 13.6 ジョブ / メンテナンス

- `GET/POST /api/jobs/run`
- `POST /api/jobs/conversation-logs/process`
- `POST /api/jobs/session-parts/process`
- `GET/POST /api/maintenance/cleanup`

## 14. 主要ファイル

- `lib/ai/conversationPipeline.ts`
  - 互換用の入口
- `lib/ai/conversation/`
  - spec / generate / normalize / fallback / transport の本体
  - `spec.ts` を prompt 方針の正本にし、retry も同じルールを使う
- `lib/conversation-artifact.ts`
  - 正本 artifact の schema / render / parse
- `lib/jobs/conversationJobs.ts`
  - `FINALIZE / FORMAT` と retry / observability
- `lib/jobs/sessionPartJobs.ts`
  - STT、live finalize、session promotion
- `lib/session-service.ts`
  - part から conversation を作る
- `lib/session-progress.ts`
  - Student Room の進捗状態
- `lib/transcript/source.ts`
  - evidence 用 transcript と display 用 transcript の切り分け
- `lib/transcript/glossary.ts`
  - 内部辞書と provider hint 用語の読み出し
- `lib/transcript/review-service.ts`
  - proper noun suggestion と reviewed transcript の orchestration
- `lib/transcript/review-assessment.ts`
  - reviewState と review 理由の判定
- `lib/recording/validation.ts`
  - duration gate
- `lib/ai/parentReport.ts`
  - selected artifact first のレポート生成
- `lib/operational-log.ts`
  - artifact / 保存済みログ本文から report bundle preview を作る
- `lib/runtime-paths.ts`
  - runtime 保存先の共通化
- `lib/runtime-cleanup.ts`
  - runtime file の安全な削除
- `app/app/students/[studentId]/StudentSessionConsole.tsx`
  - 録音と file upload
- `app/api/sessions/[id]/parts/route.ts`
  - file upload 入口
- `app/api/sessions/[id]/parts/live/route.ts`
  - live recording 入口
- `app/api/sessions/[id]/progress/route.ts`
  - 進捗 API

## 15. ローカル保存先ルール

- runtime data は source code と分けて扱う
- 音声アップロード、live chunk、manifest などの runtime file は `PARARIA_RUNTIME_DIR` 配下へ保存する
- `PARARIA_RUNTIME_DIR` 未設定時は後方互換のため repo 配下の `.data/` を使う
- `PARARIA_RUNTIME_DIR` を repo 外へ向けると、uploads / temp audio を完全に分離できる
- `.data/` と `.tmp/` は Git 管理対象に入れない
- benchmark や検証スクリプトの出力は `.tmp/` などの ignore 済みディレクトリへ出す
- 保存期間は `PARARIA_TRANSCRIPT_RETENTION_DAYS` / `PARARIA_AUDIO_RETENTION_DAYS` / `PARARIA_REPORT_DELIVERY_EVENT_RETENTION_DAYS` で調整する
- transcript 保存期間を過ぎたら `rawTextOriginal / rawTextCleaned / reviewedText / rawSegments / proper noun suggestion` を消す
- 削除ポリシーの詳細は `docs/data-retention-policy.md` を参照する

開発時の推奨:

```bash
# 例: repo の外に runtime 保存先を置く
PARARIA_RUNTIME_DIR=../pararia-runtime

# 例: TTL をローカルで短くする
PARARIA_TRANSCRIPT_RETENTION_DAYS=14
PARARIA_AUDIO_RETENTION_DAYS=14
```

## 16. 現在の smoke check

2026-03-27 に次を実行して通過確認済み:

- `npm run typecheck`
- `npm run test:audio-upload-support`
- `npm run test:conversation-eval -- --out .tmp/conversation-eval-report.md`
- `npm run test:generation-progress`
- `npm run test:lesson-report-flow`
- `npm run test:log-render-and-llm-retries`
- `npm run test:live-transcription`
- `npm run test:session-progress`
- `npm run test:stt-fallback`
- `npm run test:transcript-review`
- `npx tsx scripts/test-conversation-artifact-semantics.ts`
- `npm run build`

## 17. CI の品質ゲート

- GitHub Actions の `Conversation Quality` で faithfulness 系の代表チェックを回す
- workflow では PostgreSQL service container を立てて、local と同じ Prisma 前提で回す
- 実行内容:
  - `npm ci`
  - `npm run prisma:generate`
  - `npm run prisma:test:prepare`
  - `npm run typecheck`
  - `npm run test:transcript-review`
  - `npx tsx scripts/test-conversation-artifact-semantics.ts`
  - `npm run test:conversation-eval -- --out artifacts/conversation-eval-report.md`
- `conversation-eval` のレポートは artifact として保存する
- 目的は「コードは通るが、盛ったログや固有名詞崩れが入った」を PR 時点で止めること

## 18. やらないこと

- ログ生成と同時に別成果物を量産すること
- ログ本文の裏で高コストな polish を回すこと
- `artifactJson` 以外の別正本を増やすこと
- 未選択ログを勝手に保護者レポートへ混ぜること
- client 側だけで duration 制約を信じること
