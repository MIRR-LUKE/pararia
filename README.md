# PARARIA SaaS

PARARIA は、塾・個別指導・学習コーチング向けの `Teaching OS` です。  
面談と指導報告のコミュニケーションを、`面談ログ / 指導報告ログ / 保護者レポート / 共有履歴` に変換して、次の指導と保護者共有に使える状態まで運びます。

この README は、**2026-03-25 時点の実装コードに合わせた現行仕様書** です。  
旧確認フロー前提の運用は、コード・schema・seed から削除済みです。

## 1. 一言でいうと

- 主導線は `Student Room`
- 録音は `面談モード / 指導報告モード` の 2 モード
- 生成物は `面談ログ / 指導報告ログ`
- `保護者レポート` は保存済みログを全部自動混在させず、**選択したログだけ** で都度生成する
- `/app/logs` と `/app/reports` は補助面であり、主作業面ではない

## 2. 現在の主導線

1. Tutor が `Student Room` で `面談モード` か `指導報告モード` を選ぶ
2. 録音または音声取り込みを行う
3. モードに応じた成果物を生成する
4. 面談モードなら `面談ログ`、指導報告モードなら `指導報告ログ` に保存する
5. 必要なログだけを選ぶ
6. `保護者レポート` を生成する
7. 内容を確認して共有する

重要:

- 保護者レポートは **選択したログからのみ作成** します
- 未選択ログは使いません
- `/app/logs` と `/app/reports` は確認用の補助画面です

## 3. 用語

- `Tutor`
  - 生徒ごとの daily work を進める講師
- `Manager`
  - 朝の優先順位付けと運用確認を行う責任者
- `Guardian`
  - 保護者レポートの共有先
- `面談モード`
  - 面談を記録して `面談ログ` を作るモード
- `指導報告モード`
  - 授業・指導報告を記録して `指導報告ログ` を作るモード
- `面談ログ`
  - 面談モードから生成されたログ
- `指導報告ログ`
  - 指導報告モードから生成されたログ
- `保護者レポート`
  - 選択したログから都度生成する共有用の文章

## 4. 画面構成

### 4.1 ダッシュボード (`/app/dashboard`)

現在の役割:

- 今日すぐ動くべき生徒を優先順に出す
- `面談を始める` / `授業を始める` の 2 CTA を先頭に出す
- `面談未実施 / チェックアウト待ち / レポート未作成 / 共有待ち` を summary strip で見せる

実装上のポイント:

- KPI ダッシュボードではなく、**今日の優先キュー** 型
- 管理者はここから Student Room に降りる
- 招待 UI は `ADMIN / MANAGER` にだけ出す

### 4.2 生徒一覧 (`/app/students`)

現在の役割:

- 生徒検索
- `すべて / 面談待ち / ログあり / 共有待ち` で絞り込み
- 最小入力で生徒を追加
- Student Room へ入る

重要:

- ここでは録音や保護者レポート生成を完結させない
- 操作は Student Room に寄せる

### 4.3 Student Room (`/app/students/[studentId]`)

現在の主作業面です。

実装上の主要ブロック:

1. `Header / 生徒情報`
2. `StudentSessionConsole`
   - `面談モード / 指導報告モード`
   - 指導報告時の `CHECK_IN / CHECK_OUT`
   - 録音開始 / 音声取り込み
3. `保護者レポート生成カード`
   - レポート候補ログの選択
   - `保護者レポートを生成`
4. `ワークスペース tab`
   - `面談ログ`
   - `指導報告ログ`
   - `保護者レポートログ`
5. `overlay`
   - `LogView`（面談ログ / 指導報告ログ 共通）
   - `ReportStudio`
   - 保護者レポート詳細

この画面でやること:

- モード切替
- 録音
- 面談ログ / 指導報告ログの確認
- 保護者レポート用ログの選択
- 保護者レポート生成
- 送付済み更新

### 4.4 ログ参照 (`/app/logs`)

現在の役割:

- 面談ログ / 指導報告ログの補助参照
- ログ本文・文字起こしの確認
- どの保護者レポートに使われたかを追うための補助面

### 4.5 送付前レビュー (`/app/reports`)

現在の役割:

- `レポート未作成 / 共有待ち / 送付済み` の補助確認
- 主作業は Student Room に戻す

### 4.6 システム設定 (`/app/settings`)

現在の役割:

- UI 基盤メモ
- モード別ログ生成と共有運用の方針メモ
- 組織情報の下書き
- 音声保持方針の下書き

注意:

- `Settings / Admin` では、組織名更新、guardian 連絡先カバレッジ確認、未入力生徒の guardianNames 補完、送信設定サマリー、権限人数、保存期間ポリシーを確認できます
- 詳細な送信プロバイダ設定や LINE 連携の編集 UI は、引き続き `task.md` の P0/P1 で拡張します

## 5. データモデル

### 5.1 組織 / ユーザー

- `Organization`
- `User`
  - ロール: `ADMIN | MANAGER | TEACHER | INSTRUCTOR`
- `OrganizationInvitation`

### 5.2 生徒と記録

- `Student`
- `StudentProfile`
- `Session`
  - 1 回の面談または指導報告
- `SessionPart`
  - 面談なら `FULL`
  - 指導報告なら `CHECK_IN / CHECK_OUT`

### 5.3 ログとレポート

- `ConversationLog`
  - 面談モードなら `面談ログ`
  - 指導報告モードなら `指導報告ログ`
  - 現行の主保存物は `summaryMarkdown` と transcript 系 (`rawTextOriginal / rawTextCleaned / rawSegments / formattedTranscript`) と `qualityMetaJson`
  - 旧 structured JSON カラムは schema 互換のため残るが、現行主導線では基本的に `null` として扱う
- `ConversationJob`
  - 現行主導線では通常 `FINALIZE` を enqueue し、必要時のみ `FORMAT` を追加する
  - `CHUNK_ANALYZE / REDUCE` は補助経路・検証用として残る
- `Report`
  - 保護者レポート本体
  - `sourceLogIds` で使用ログを追う
- `AuditLog`

### 5.4 録音ロック

- `StudentRecordingLock`
  - 同一生徒の同時録音を防ぐ

削除済み:

- 旧確認用テーブル
- 旧確認用カラム
- 旧確認用集計値

## 6. 録音とログ生成

### 6.1 入力経路

1. `Student Room` からのセッション入力
2. `POST /api/audio` の補助経路
3. `POST /api/conversations` の transcript 直入力
4. 主要な Student / Session / Conversation / Report API は NextAuth session の `organizationId` でスコープする

### 6.2 面談モード

- 1 セッション = 1 part (`FULL`)
- 上限 60 分
- 生成物:
  - `面談ログ`
  - `文字起こし`（`formattedTranscript` が無ければ raw transcript をそのまま表示）

重要:

- 現行のユーザー向け成果物は `面談ログ` 本体と `文字起こし` のみ
- 話題候補 / 根拠タブ / 補助生成物タブは削除済み

### 6.3 指導報告モード

- 1 セッション内で `CHECK_IN` と `CHECK_OUT`
- 両方揃うと生成開始
- 上限 10 分 / part
- 生成物:
  - `指導報告ログ`
  - `文字起こし`（`formattedTranscript` が無ければ raw transcript をそのまま表示）

重要:

- `CHECK_IN` と `CHECK_OUT` は同じ lesson session に集約し、そろった時点で 1 本の `指導報告ログ` を生成する
- ユーザー向けには `指導報告ログ` 本体を見せ、裏側の別成果物は増やさない

### 6.4 録音後の標準フロー

1. モードを選ぶ
2. 録音する
3. STT と transcript 前処理を行う
4. job を enqueue する
5. 通常は保存直後に background worker (`processAllConversationJobs`) を起動する
6. `FINALIZE` でログ本文を生成し、必要時のみ `FORMAT` で文字起こし表示を整形する
7. `面談ログ` または `指導報告ログ` に保存する
8. Student Room / Logs の poll でも `?process=1` により worker を再キックできる
9. Student Room に戻して一覧へ反映する

## 7. 保護者レポート

### 7.1 重要ルール

- 保護者レポートは **選択したログだけ** を使う
- 未選択ログは使わない
- 追加候補は提案だけで、自動追加はしない

### 7.2 現在のレポート状態

DB の `Report.status` は現時点で次の 3 状態です。

- `DRAFT`
- `REVIEWED`
- `SENT`

UI 上では主に次で見せています。

- `未作成`
- `下書きあり`
- `確認済み`
- `送付済み`

補足:

- `failed / bounced / delivered / manually_confirmed / resent / draft_created` の delivery event は実装済みです
- Student Room / Reports / Logs は最新 event をもとに共有状態を表示します。Dashboard では `average time-to-share` まで確認でき、Settings では guardianNames 補完まで進められます

### 7.3 生成から共有まで

1. Student Room でログを選択
2. `保護者レポートを生成`
3. `ReportStudio` でドラフトを確認
4. `POST /api/reports/[id]/send` で `SENT` に更新

### 7.4 使用ログの追跡

- `Report.sourceLogIds` に使用ログを保存
- Reports / Logs / Student Room から、どのログを使ったかを参照できる

### 7.5 日本語保証

`lib/ai/parentReport.ts` では次の順で日本語品質を担保しています。

1. prompt で日本語を要求
2. 選択ログ束ねで材料をそろえる
3. JSON parse
4. sanitize
5. markdown render

## 8. 生成パイプライン

主要ファイル:

- `lib/jobs/conversationJobs.ts`
- `lib/ai/conversationPipeline.ts`
- `lib/operational-log.ts`
- `lib/session-service.ts`

標準フロー:

1. 録音またはアップロード
2. 録音バリデーション
3. transcript 前処理
4. job enqueue
5. `FINALIZE` ジョブで `generateConversationArtifactsSinglePass` を実行
6. `summaryMarkdown` を `ConversationLog` に保存
7. 必要時のみ `FORMAT` で文字起こし表示を整形する
8. Student Room / Logs / Reports で表示

### 8.1 モード別生成の扱い

- `lib/session-service.ts` は `READY` の part だけを transcript にまとめる
- `指導報告モード` では `CHECK_IN` と `CHECK_OUT` を同じ lesson session に集め、2 本がそろってから 1 本の指導報告ログを生成する
- `面談モード` は `FULL -> CHECK_IN -> CHECK_OUT -> TEXT_NOTE` の順で transcript を組む
- `指導報告モード` は `CHECK_IN -> FULL -> CHECK_OUT -> TEXT_NOTE` の順で transcript を組む
- `lib/jobs/conversationJobs.ts` の現行標準導線は `FINALIZE` ジョブ中心で、面談ログ / 指導報告ログの本文を直接生成する
- `CHUNK_ANALYZE / REDUCE / finalizeConversationArtifacts` は補助経路・検証用として残る
- `/api/ai/analyze-conversation` と `lib/analytics/conversationAnalysis.ts` でも `sessionType` を受け取れるが、主導線は Student Room の録音導線
- `POST /api/sessions/[id]/parts` は part 保存成功後に生成キックが失敗しても 500 にせず、クライアント側で `/api/sessions/[id]/generate` を再試行できる
- `POST /api/sessions` は lesson report の未完了 session を再利用するため、チェックイン後のチェックアウトが別 session に分かれにくい
- Student Room では `面談 / 指導報告 / 保護者レポート` の全生成フローで progress bar を表示する
- `GET /api/conversations/[id]?brief=1&process=1` は poll 用の軽量取得と worker 再キックを兼ねる
- `POST /api/conversations/[id]/regenerate` は再生成を開始し、既に同一ログが生成中なら `409` を返す
- `POST /api/conversations/[id]/format` は `FORMAT` を queue し、即時 worker を起動する

### 8.2 今回の検証コマンド

- `npm run lint`
- `npm run typecheck`
- `npm run test:conversation-modes`
- `npm run test:generation-progress`
- `npm run test:lesson-report-flow`
- `npm run test:log-render-and-llm-retries`
- `npm run test:live-transcription`
- `npm run test:single-pass-fast-path`
- `npm run build`

`npm run test:conversation-modes` は OpenAI 実APIなしで `面談モード / 指導報告モード` の両方について、`analyze -> reduce -> finalize` と `single-pass` の生成経路を smoke test します。
`npm run test:generation-progress` は Student Room の `面談 / 指導報告 / 保護者レポート` progress bar が期待どおりの段階を返すかを smoke test します。
`npm run test:lesson-report-flow` は `CHECK_IN -> CHECK_OUT -> 合算生成` の lesson report 導線が想定どおりの next step を返すかを smoke test します。
`npm run test:log-render-and-llm-retries` は ログ表示 parser が `基本情報 / 話者行 / 箇条書き` を崩さず解釈できることと、LLM 呼び出しの retry が 429 で復元できることを smoke test します。
`npm run test:live-transcription` は live transcription 側の STT metadata 集約と回復系メタの扱いを smoke test します。
`npm run test:single-pass-fast-path` は現行の主導線である `single-pass -> summaryMarkdown` の高速生成経路を smoke test します。

代表的な成果物:

- `summaryMarkdown`
- `formattedTranscript`
- `rawTextOriginal`
- `rawTextCleaned`
- `rawSegments`
- `qualityMetaJson`

補足:

- 旧 structured JSON (`timelineJson` など) のカラムは schema 互換のため残る
- ただし現行主導線では、API / Room / Logs / Reports の表示や保護者レポート生成でそれらを前提にしない

## 9. 録音ロックと保持方針

### 9.1 録音ロック

- API: `GET/POST/PATCH/DELETE /api/students/[id]/recording-lock`
- DB: `StudentRecordingLock`
- heartbeat が止まった lock は TTL で失効

### 9.2 音声と transcript

- 音声バイナリそのものは永続保存しない
- transcript と meta を保存する
- raw transcript は TTL 付き

### 9.3 cleanup

`/api/maintenance/cleanup` は次を削除します。

- `ConversationLog.rawTextOriginal`
- `ConversationLog.rawTextCleaned`
- `ConversationLog.rawSegments`

## 10. API 一覧

### 10.1 認証

- `POST /api/auth/login`
- `GET/POST /api/auth/[...nextauth]`
- 主要な `Student / Session / Conversation / Report` API は NextAuth session を要求し、`organizationId` でスコープする

### 10.2 生徒

- `GET/POST /api/students`
- `GET/PUT /api/students/[id]`
- `GET /api/students/[id]/room`
- `GET/POST/PATCH/DELETE /api/students/[id]/recording-lock`

### 10.3 セッション

- `GET/POST /api/sessions`
- `GET/PATCH /api/sessions/[id]`
- `POST /api/sessions/[id]/parts`
- `POST /api/sessions/[id]/generate`

### 10.4 コミュニケーションログ

- `GET/POST /api/conversations`
- `GET/PATCH/DELETE /api/conversations/[id]`
- `POST /api/conversations/[id]/regenerate`
- `POST /api/conversations/[id]/format`
- `POST /api/audio`

補足:

- `POST /api/conversations` は transcript 直入力を受け取り、job enqueue 後に background worker を即起動する
- `GET /api/conversations/[id]?brief=1&process=1` は poll 用の軽量レスポンスを返しつつ worker 再キックにも使う
- `POST /api/conversations/[id]/regenerate?format=1` は再生成に加えて `FORMAT` も再実行する

### 10.5 保護者レポート

- `POST /api/ai/generate-report`
- `POST /api/reports/[id]/send`

### 10.6 招待

- `GET/POST /api/invitations`
- `POST /api/invitations/accept`

### 10.7 ジョブ / メンテナンス

- `GET/POST /api/jobs/run`
- `POST /api/jobs/conversation-logs/process`
- `GET/POST /api/maintenance/cleanup`

## 11. 非目標 / 後回し

- `Campus` 正規モデル
- campus 比較
- LINE 第二チャネル
- 週次レビュー card / reminder / digest
- 広い SIS
  - 出欠
  - 請求
  - 会計
  - 時間割

## 12. どこを見れば何が分かるか

- 認証: `auth.ts`, `middleware.ts`, `app/api/auth/*`
- schema: `prisma/schema.prisma`
- seed: `prisma/seed.ts`
- 会話生成: `lib/ai/conversationPipeline.ts`
- transcript 整形: `lib/ai/llm.ts`
- 保護者レポート: `lib/ai/parentReport.ts`
- Operational Log: `lib/operational-log.ts`
- セッション同期: `lib/session-service.ts`
- 録音ロック: `lib/recording/lockService.ts`
- 録音バリデーション: `lib/recording/validation.ts`
- job runner: `lib/jobs/conversationJobs.ts`
- Student Room UI: `app/app/students/[studentId]/page.tsx`
