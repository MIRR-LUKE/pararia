# PARARIA SaaS

PARARIA は、塾・個別指導・学習コーチング向けの `Teaching OS` です。  
現在の実装は、**録音や会話メモから `面談ログ` または `指導報告ログ` を 1 本生成し、その保存済みログを選んで `保護者レポート` を作る** ことに絞っています。

この README は、**2026-03-26 時点の現行コードと一致する運用仕様書** です。

## 1. 先に結論

- 主導線は `Student Room`
- 録音モードは `INTERVIEW` と `LESSON_REPORT` の 2 つ
- 生成物はまず `面談ログ` または `指導報告ログ` の **本文 1 本だけ**
- ログ生成は `ConversationJob.FINALIZE` の **単発実行**
- 自動の後段 polish は **ない**
- 旧 structured artifact は **生成しない / 保存しない / UI で使わない**
- `保護者レポート` は **選択したログの `summaryMarkdown` だけ** から生成する
- 未選択ログ、前回レポート、プロフィール snapshot はレポート本文生成に入れない

## 2. 非交渉の設計原則

### 2.1 Log Only

- 面談モードの成果物は `面談ログ`
- 指導報告モードの成果物は `指導報告ログ`
- どちらも first-class output は `summaryMarkdown`
- 補助表示として `formattedTranscript` または raw transcript を持つ
- 旧 `timeline / nextActions / parentPack / profileDelta` 系の自動生成は廃止済み

### 2.2 Single Finalize Pass

- ログ本文は `FINALIZE` 1 回で `DONE` にする
- 後段の追加仕上げ job や段階的 finalize は使わない
- `FORMAT` は transcript 表示が必要なときだけ追加する
- 生成途中の「下書き公開 + 裏で最終調整」はしない

### 2.3 Selected SummaryMarkdown Only

- 保護者レポートに入れる材料は選択済みログの `summaryMarkdown`
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
  - 音声ファイル取り込み
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

- `summaryMarkdown`
- `rawTextOriginal`
- `rawTextCleaned`
- `rawSegments`
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

- `summaryMarkdown`
- `rawTextOriginal`
- `rawTextCleaned`
- `rawSegments`
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
- chunking 条件:
  - `75 秒以上` で分割
  - `30 秒` chunk
  - `最大 6 並列`
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
  - transcript からログ本文を 1 本作る
  - 完了時に `ConversationLog.status = DONE`
- `FORMAT`
  - transcript 表示を整形する
  - 本文生成の必須条件ではない

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

- `summaryMarkdown`
  - 現行の本命成果物
- `rawTextOriginal`
  - 元 transcript
- `rawTextCleaned`
  - 前処理後 transcript
- `rawSegments`
  - STT segment
- `formattedTranscript`
  - 必要時だけ整形
- `qualityMetaJson`
  - STT 時間、モデル、警告、生成時間など

## 10. 保護者レポート

### 10.1 入力ルール

- 選択したログだけを使う
- 本文生成に入るのは各ログの `summaryMarkdown`
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

### 11.2 server 側

- `POST /api/sessions/[id]/parts`
  - file upload duration を解析して reject
- `POST /api/sessions/[id]/parts/live`
  - live chunk 累積 duration を見て reject
- duration 不明なら strict に reject する経路を持つ

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

補足:

- `POST /api/conversations`
  - transcript 直入力を受けて background worker を起動する
- `GET /api/conversations/[id]?brief=1&process=1`
  - 軽量取得 + worker 再キック
- `POST /api/conversations/[id]/regenerate?format=1`
  - 再生成に加えて transcript 整形も再実行

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
  - ログ本文生成
- `lib/jobs/conversationJobs.ts`
  - `FINALIZE / FORMAT`
- `lib/jobs/sessionPartJobs.ts`
  - STT、live finalize、session promotion
- `lib/session-service.ts`
  - part から conversation を作る
- `lib/session-progress.ts`
  - Student Room の進捗状態
- `lib/recording/validation.ts`
  - duration gate
- `lib/ai/parentReport.ts`
  - selected summaryMarkdown only のレポート生成
- `lib/operational-log.ts`
  - 保存済みログ本文から report bundle preview を作る
- `app/app/students/[studentId]/StudentSessionConsole.tsx`
  - 録音と file upload
- `app/api/sessions/[id]/parts/route.ts`
  - file upload 入口
- `app/api/sessions/[id]/parts/live/route.ts`
  - live recording 入口
- `app/api/sessions/[id]/progress/route.ts`
  - 進捗 API

## 15. 現在の smoke check

- `npm run typecheck`
- `npm run test:generation-progress`
- `npm run test:lesson-report-flow`
- `npm run test:log-render-and-llm-retries`
- `npm run test:live-transcription`
- `npm run build`

## 16. やらないこと

- ログ生成と同時に別成果物を量産すること
- ログ本文の裏で高コストな polish を回すこと
- 旧 structured artifact を UI やレポートの前提に戻すこと
- 未選択ログを勝手に保護者レポートへ混ぜること
- client 側だけで duration 制約を信じること
