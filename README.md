# PARARIA SaaS

PARARIA は、塾・個別指導・学習コーチング向けの `Teaching OS` です。  
録音した会話をそのまま残すのではなく、`会話ログ -> 生徒理解 -> 指導報告書 -> 保護者レポート` に変換して、次の指導に使える状態まで運びます。

この README は、**2026-03-20 時点の実装コードを基準に再構成した現行仕様書** です。  
README に書かれている内容は、`prisma/schema.prisma`、`app/api/*`、`app/app/*`、`lib/*` の実装と揃えています。

## 1. いまのプロダクト全体像

PARARIA の主導線は次の 3 つです。

- `概要` (`/app/dashboard`)
- `生徒一覧` (`/app/students`)
- `設定` (`/app/settings`)

Sidebar もこの 3 つに絞っており、`Reports` と `Logs` は主ナビから外しています。

実務の中心は **生徒詳細ページ (`/app/students/[studentId]`)** です。  
このページの中で次の作業を完結させる設計になっています。

- 面談録音の開始
- 指導報告のチェックイン / チェックアウト録音
- 生成進行の確認
- 会話ログの確認
- 根拠・固有名詞確認
- 指導報告書の確認
- 保護者レポート用ログの選択
- 保護者レポート生成
- 送付前確認
- 手動送付

`/app/logs` と `/app/reports` は残っていますが、主導線ではなく **確認用の補助面** です。

また、次のルートは互換用に残しています。

- `/app` -> `/app/dashboard` へ redirect
- `/app/logs/[logId]` -> 該当生徒の Student Room 内 proof 表示へ redirect
- `/app/students/[studentId]/logs/[logId]` -> 該当生徒の Student Room 内 proof 表示へ redirect
- `/app/reports/[studentId]` -> 該当生徒の Student Room 内 report 表示へ redirect
- `/app/students/[studentId]/sessions/new` -> 該当生徒の Student Room 内 recording 表示へ redirect

## 2. アーキテクチャ

### 2.1 技術スタック

- フロントエンド: `Next.js 14 App Router` + `React 18`
- 認証: `NextAuth v5 beta (Credentials)`
- DB / ORM: `PostgreSQL` + `Prisma`
- AI:
  - STT: OpenAI Audio Transcriptions
  - 会話構造化 / 要約 / 保護者レポート: OpenAI Chat Completions
- UI 状態管理: React state 中心
- スタイル: CSS Modules
- 背景ジョブ: **DB ベースの conversation jobs runner**

### 2.2 レイヤー構成

1. `app/app/*`
- 画面とユーザー導線
- 主導線は `概要 -> 生徒一覧 -> 生徒詳細`

2. `app/api/*`
- REST API
- 生徒 / セッション / 会話ログ / レポート / 招待 / 録音ロック / ジョブ実行

3. `lib/*`
- STT、LLM、前処理、会話ログ再構成、プロフィール更新、録音ロック、招待、組織解決などの中核ロジック

4. `prisma/*`
- スキーマ、マイグレーション、シード

補足:

- `app/layout.tsx` は `ThemeProvider` と `AuthProvider` を root に入れています
- `app/app/layout.tsx` は `auth()` を見て、未ログインなら `/login` に redirect します

### 2.3 実装上の重要な分離

このリポジトリでは、入力・生成物・送付物を分けています。

- `Session`: 面談 / 指導報告という「指導単位」
- `SessionPart`: 1 セッションの入力片。面談なら `FULL`、指導報告なら `CHECK_IN` / `CHECK_OUT`
- `ConversationLog`: セッションから生成される会話ログ本体
- `Report`: 選択した会話ログから作る保護者レポート

つまり、**録音ファイルそのものを中心にしていません**。  
中心にあるのは `Session -> ConversationLog -> Report` です。

## 3. データモデル

主要モデルだけ先に押さえると、全体が理解しやすくなります。

### 3.1 組織 / ユーザー

- `Organization`
  - テナント単位
  - 既定値は `org-demo`
- `User`
  - `organizationId` を持つ
  - ロール: `ADMIN | MANAGER | TEACHER | INSTRUCTOR`
- `OrganizationInvitation`
  - 招待トークンのハッシュ、期限、ロールを保持

### 3.2 生徒・理解の蓄積

- `Student`
  - 生徒基本情報
- `StudentProfile`
  - 最新プロフィールスナップショット
  - `profileData` に `basic` / `personal` の差分蓄積
- `StudentEntity`
  - 生徒辞書
  - 確定済みの学校名、教材名、志望校名など

### 3.3 録音とセッション

- `Session`
  - 種別: `INTERVIEW | LESSON_REPORT`
  - 状態: `DRAFT | COLLECTING | PROCESSING | READY | ERROR`
  - Hero 用の要約 (`heroStateLabel`, `heroOneLiner`) も保持
- `SessionPart`
  - `FULL | CHECK_IN | CHECK_OUT | TEXT_NOTE`
  - 音声バイナリは保存しない
  - 保存するのは transcript、segments、メタ情報、期限付き raw text
- `StudentRecordingLock`
  - 同時録音防止用ロック
  - heartbeat 更新あり

### 3.4 生成物

- `ConversationLog`
  - 会話ログの原本
  - `summaryMarkdown`, `timelineJson`, `nextActionsJson`, `profileDeltaJson`, `parentPackJson`, `studentStateJson`, `topicSuggestionsJson`, `quickQuestionsJson`, `profileSectionsJson`, `entityCandidatesJson`, `lessonReportJson` などを保持
  - `sessionId` はユニークなので、**1 セッションに対して 1 会話ログ** の運用
- `ConversationJob`
  - 生成ジョブのステップ管理
  - `CHUNK_ANALYZE -> REDUCE -> FINALIZE` が基本
  - 必要時のみ `FORMAT`
- `SessionEntity`
  - セッション単位の固有名詞候補
- `Report`
  - 保護者レポート本文
  - 参照ログ ID 群
  - 送付状態
  - 品質チェック結果
- `AuditLog`
  - 管理操作ログの一部に使用

## 4. 画面と導線

### 4.1 ログイン

- ページ: `/login`
- 招待受諾ページ: `/invite/accept`
- 実装: `NextAuth Credentials`
- デフォルト seed アカウント:
  - `admin@demo.com / demo123`

### 4.2 概要 (`/app/dashboard`)

役割:

- 今日優先して動くべき生徒を出す
- 未面談、授業途中、要確認、レポ待ちのキューを出す
- 生徒詳細へ進む入り口にする

ここは情報倉庫ではなく、**行動キュー** です。

### 4.3 生徒一覧 (`/app/students`)

役割:

- 生徒を検索する
- フィルタで絞る
- 生徒詳細へ入る
- 新規生徒を作る

**重要**: ここでは録音やレポ生成を直接させません。  
各行は `生徒詳細へ` に寄せています。

### 4.4 生徒詳細 (`/app/students/[studentId]`)

現在の主作業面です。

#### 上段サマリー

- 生徒名、学年、一言サマリー
- 状態バッジ
- 今の全体像
- おすすめの話題
- 主録音操作
  - 面談 / 指導報告 モード切替
  - 指導報告時の `チェックイン / チェックアウト` 切替
  - `録音開始` ボタン
- 進行中件数、未確認 entity 件数などの補助表示

#### 下段タブ

1. `プロフィール`
- 学習 / 学校 / 生活 / 進路 の固定カテゴリ
- それぞれ `現在の状態 / 今回の更新 / 講師の見立て / 次に確認すること / 根拠ログ導線`

2. `コミュニケーション履歴`
- 会話ログ一覧
- 保護者レポート素材の選択元
- 詳細は別ページではなく画面内オーバーレイ

3. `指導報告書履歴`
- 過去 lesson report の確認

4. `保護者レポート履歴`
- 過去 report の確認
- 再送や送付前確認の入口

#### オーバーレイで開くもの

- `StudentSessionConsole`: 録音開始 / 進行中 / アップロード
- `LogDetailView`: 会話ログ詳細
- `ReportStudio`: 保護者レポート生成 / 送付前確認
- 指導報告詳細
- 保護者レポート詳細

### 4.5 ログ一覧 (`/app/logs`)

- 裏面の確認用画面
- 根拠確認や QA 用
- 主導線ではない

### 4.6 レビュー一覧 (`/app/reports`)

- 送付前レビューの補助面
- 主導線ではない
- 本命は生徒詳細の中での report flow

### 4.7 設定 (`/app/settings`)

- テーマ切替 (`system / light / dark`)
- レビュー運用方針表示
- 組織情報の下書き
- 音声保持ポリシー表示

注意:

- テーマ設定は **localStorage に保存する端末ローカル設定** です
- サーバー同期は未実装です

## 5. 認証・テナント・アクセス制御

### 5.1 アプリ認証

- `auth.ts` で `NextAuth Credentials` を構成
- JWT session strategy
- session に `id`, `email`, `name`, `role`, `organizationId` を保持

補足:

- 実際のログイン導線は `next-auth/react` の `signIn(\"credentials\")`
- `POST /api/auth/login` も残っていますが、こちらは **資格情報の素通し確認用の補助 API** で、Cookie / Session を発行しません

### 5.2 Optional Basic Auth

`middleware.ts` で次をサポートしています。

- `BASIC_AUTH_USER`
- `BASIC_AUTH_PASS`

この値がある場合、アプリ全体に Basic 認証をかけられます。

### 5.3 Cron secret bypass

`middleware.ts` は cron 実行用に次も許可します。

- Header: `x-cron-secret`
- Query: `cron_secret`

### 5.4 招待フロー

- `POST /api/invitations`
  - 管理者 / マネージャーが招待作成
- `POST /api/invitations/accept`
  - 招待トークンで参加

注意:

- MANAGER は ADMIN / MANAGER の招待を作れません
- 招待 URL は API 応答で返します
- 有効期限は `INVITATION_EXPIRES_DAYS`

## 6. 録音ロック

複数講師が同じ生徒で同時録音しないよう、録音ロックがあります。

### 6.1 実装

- API: `GET/POST/PATCH/DELETE /api/students/[id]/recording-lock`
- DB: `StudentRecordingLock`
- ロジック: `lib/recording/lockService.ts`

### 6.2 挙動

- `POST`: lock 取得
- `PATCH`: heartbeat
- `DELETE`: release
- `forceRelease`: ADMIN / MANAGER のみ

### 6.3 保証していること

- 他ユーザーが同一生徒を録音中なら開始できない
- heartbeat が止まった lock は TTL で失効
- 音声アップロード時にも token を再検証

## 7. 録音・入力の種類

### 7.1 現在の入力経路

1. **生徒詳細からのセッション入力**
- 主導線
- `Session` / `SessionPart` を経由する

2. **直接 audio upload (`/api/audio`)**
- ConversationLog を直接作る旧経路 / 補助経路
- Session を経由しない

3. **直接 transcript 入力 (`POST /api/conversations`)**
- 手入力 transcript から ConversationLog を直接作成

### 7.2 面談モード

- 1 セッション = 1 part (`FULL`)
- 上限 60 分
- 生成物:
  - 会話ログ
  - プロフィール更新案
  - topic / quick question / next action
  - entity 候補
- 作らないもの:
  - 指導報告書

### 7.3 指導報告モード

- 1 セッションの中に `CHECK_IN` と `CHECK_OUT`
- 両方揃うと会話ログ生成開始
- 上限 10 分 / part
- 生成物:
  - 会話ログ
  - プロフィール更新案
  - entity 候補
  - 指導報告書
  - 保護者レポート素材

## 8. 録音バリデーション

ロジック: `lib/recording/validation.ts`

### 8.1 ゲート A: 録音時間

- `music-metadata` で duration を解析
- デフォルト最短: `60 秒`
- `RECORDING_MIN_DURATION_SECONDS` で変更可能
- `RECORDING_REQUIRE_KNOWN_DURATION=1` のときは duration 解析失敗も reject

### 8.2 ゲート B: transcript の中身

STT のあと、次を見ています。

- 有意文字数
- filler だらけでないか
- 同一文字の繰り返しすぎでないか
- 実質的に中身があるか

短すぎる / 薄すぎる transcript は `422` で reject し、生成を開始しません。

## 9. STT 実装

ロジック: `lib/ai/stt.ts`

### 9.1 使用モデル

- 本線: `STT_MODEL` (`gpt-4o-transcribe` デフォルト)
- フォールバック: `STT_FALLBACK_MODEL` (`gpt-4o-mini-transcribe` デフォルト)
- 詳細用途: `STT_DETAILED_MODEL` (`gpt-4o-transcribe-diarize` デフォルト)

### 9.2 実際の使い分け

- 生成本線では `transcribeAudioForPipeline()` を使う
- timeout / 5xx / response_format 不整合時は fallback model に自動退避
- detailed / diarize は補助用途用関数として残している

### 9.3 音声ファイルの扱い

**音声バイナリそのものは永続保存していません。**

- API で buffer を受け取る
- STT へ投げる
- transcript と meta だけ残す
- buffer はそのまま破棄

## 10. transcript 前処理

ロジック: `lib/transcript/preprocess.ts`

### 10.1 やっていること

- 日本語 whitespace 正規化
- filler 除去
- 隣接重複行の除去
- sentence-ish chunk 化
- 近接重複 chunk の除去
- トピック境界推定
- LLM 向け block 化

### 10.2 出力

- `rawTextOriginal`
- `rawTextCleaned`
- `chunks`
- `blocks`

block は後段の `CHUNK_ANALYZE` にそのまま使います。

## 11. セッションから会話ログへ

ロジック: `lib/session-service.ts`

### 11.1 Session readiness

- `INTERVIEW`: READY な part が 1 つ以上あれば生成可能
- `LESSON_REPORT`: `CHECK_IN` と `CHECK_OUT` が両方 READY で初めて生成可能

### 11.2 transcript 合成

`buildSessionTranscript()` は part を次の順で結合します。

- `CHECK_IN`
- `FULL`
- `CHECK_OUT`
- `TEXT_NOTE`

### 11.3 会話ログ作成

`ensureConversationForSession()` は:

- Session から transcript を組み直す
- 既存 `ConversationLog` があれば上書き再利用
- なければ新規作成
- Session と 1:1 を維持

### 11.4 ステータスの意味

#### Session

- `DRAFT`: まだ入力がない
- `COLLECTING`: lesson report の片側だけ揃っている
- `PROCESSING`: 会話ログ生成中
- `READY`: 会話ログ生成完了
- `ERROR`: part か生成のどこかで失敗

#### SessionPart

- `PENDING`: 未入力
- `UPLOADING`: アップロード中
- `TRANSCRIBING`: STT 中
- `READY`: transcript 利用可能
- `ERROR`: validation か STT で失敗

#### ConversationLog

- `PROCESSING`: まだ生成途中
- `PARTIAL`: 一部成果物だけ出ている
- `DONE`: 会話ログ生成完了
- `ERROR`: job エラー

## 12. 会話ログ生成パイプライン

ロジック:

- `lib/jobs/conversationJobs.ts`
- `lib/ai/conversationPipeline.ts`
- `lib/operational-log.ts`

### 12.1 標準フロー

1. `CHUNK_ANALYZE`
- block ごとに事実 / 指導ポイント / decision / todo / timeline candidate / profile delta candidate を抽出

2. `REDUCE`
- 複数 block の分析結果を統合

3. `FINALIZE`
- UI と運用で使う成果物へ変換

### 12.2 生成される成果物

- `summaryMarkdown`
- `timelineJson`
- `nextActionsJson`
- `profileDeltaJson`
- `parentPackJson`
- `studentStateJson`
- `topicSuggestionsJson`
- `quickQuestionsJson`
- `profileSectionsJson`
- `observationJson`
- `entityCandidatesJson`
- `lessonReportJson` (lesson mode only)

### 12.3 single-pass モード

条件を満たす短い会話は `single-pass` で処理します。

条件:

- `ENABLE_SINGLE_PASS_MODE !== 0`
- block 数 <= `SINGLE_PASS_MAX_BLOCKS`
- 文字数 <= `SINGLE_PASS_MAX_CHARS`

single-pass では、`ANALYZE + REDUCE + FINALIZE` を 1 回で作り、後段 job は `skip-single-pass` として DONE にします。

### 12.4 heuristic fallback / repair

FINALIZE 系では次も入っています。

- summary が短すぎると fallback
- timeline / actions / profile delta / parent pack / student state などが不足すると repair
- それでも足りない部分は heuristic で埋める

### 12.5 prompt / cost meta

各生成で `qualityMetaJson` と job の `costMetaJson` に次を残します。

- 使用モデル
- 秒数
- 推定 token 数
- API call 数
- repaired したか
- single-pass か
- promptVersion

## 13. 会話ログの再構成

ロジック: `lib/operational-log.ts`

LLM の出力はそのまま UI に流していません。  
一度 `OperationalLog` に組み替えています。

### 13.1 OperationalLog の標準形

- `theme`
- `facts`
- `changes`
- `assessment`
- `nextChecks`
- `parentShare`
- `entities`

### 13.2 使い道

- 生徒詳細のコミュニケーション履歴カード
- ログ詳細画面
- 保護者レポート用 bundle の材料
- summaryMarkdown の再レンダリング
- reuse blocks の生成

### 13.3 目的

- transcript ダンプをそのまま見せない
- UI で読む順番を固定する
- parent report の素材として再利用しやすくする

## 14. プロフィール更新

ロジック: `lib/profile.ts`

### 14.1 更新方式

- `ProfileDelta` を受ける
- `StudentProfile.profileData` の最新 snapshot に merge
- 重複キー (`field::value`) は上書き
- `updatedAt`, `sourceLogId` を付与

### 14.2 注意

- 履歴型ではなく、**最新 snapshot を育てる方式**
- ConversationLog 生成後に `applyProfileDelta()` を呼ぶ
- エラーでも ConversationLog 自体は保存されるよう non-fatal 扱いの箇所がある

## 15. transcript 整形

ロジック: `lib/ai/llm.ts`

### 15.1 用途

- transcript を Speaker 付きで読みやすく整形
- `FORMAT` job でのみ使う
- 主生成パイプラインの必須依存ではない

### 15.2 実装

- segment がある場合は diarization / refinement を行う
- segment がない場合は paragraph 単位で speaker unknown 形式に整形

### 15.3 位置づけ

これは **表示品質の向上用** です。  
会話ログの核心は `operational-log` と `FINALIZE` 側にあります。

補足:

- `lib/ai/llm.ts` には旧来の parent report helper も残っています
- ただし、**現在の主系統で使っている保護者レポート生成は `lib/ai/parentReport.ts`** です

## 16. 指導報告書

lesson mode のときだけ `lessonReportJson` を生成します。

UI 上では次の観点で扱っています。

- 今日扱った内容
- 今日見えた理解状態
- 詰まった点 / 注意点
- 次回見るべき点
- 宿題 / 確認事項
- 講師間共有メモ

詳細表示は生徒詳細ページのオーバーレイで行います。

## 17. 保護者レポート

ロジック:

- `lib/ai/parentReport.ts`
- `POST /api/ai/generate-report`

### 17.1 重要ルール

- **保護者レポートは selected logs からしか作りません**
- Processing 中に自動生成しません
- 未選択ログは使いません
- 追加候補は提案だけで、自動追加しません

### 17.2 生成元

選択した `ConversationLog` から次を束ねます。

- operationalLog
- parentPack
- timeline
- nextActions
- studentState
- profileSections
- entityCandidates
- lessonReport

### 17.3 bundle quality evaluation

`buildBundleQualityEval()` で次を評価します。

- 対象期間
- ログ数
- 主テーマ
- 強い要素
- 弱い要素
- 家庭向けポイント
- 警告
- 追加候補ログ ID

### 17.4 送付制御

`POST /api/reports/[id]/send`

- `qualityChecksJson.pendingEntityCount > 0` の report は送れません
- 送付は manual 記録のみです
- 実メール送信は未実装です

## 18. entity 確認

### 18.1 セッション単位候補

Conversation 完了後、`syncSessionAfterConversation()` が:

- `ConversationLog.entityCandidatesJson` を読み
- `SessionEntity` を再構築し
- pending 数を `Session.pendingEntityCount` に反映します

### 18.2 確認 API

`PATCH /api/sessions/[id]/entities/[entityId]`

できること:

- confirm
- ignore
- canonicalValue の確定

confirm 時は `StudentEntity` にも反映し、既存 canonical に alias を追加します。

## 19. 背景ジョブ

### 19.1 実装方式

外部 queue ではなく、**DB の `ConversationJob` をポーリングして処理** します。

主な関数:

- `enqueueConversationJobs()`
- `claimNextJob()`
- `processQueuedJobs()`
- `processAllConversationJobs()`

### 19.2 実行 API

- `GET/POST /api/jobs/run`
- `POST /api/jobs/conversation-logs/process`

### 19.3 依存関係

- `CHUNK_ANALYZE` 完了後に `REDUCE`
- `REDUCE` 完了後に `FINALIZE`
- `FINALIZE` 完了後に任意 `FORMAT`

### 19.4 Cron

`vercel.json`:

- 毎分: `/api/jobs/run?limit=6&concurrency=3&cron_secret=...`
- 毎日 02:00: `/api/maintenance/cleanup?cron_secret=...`

## 20. cleanup と保持方針

### 20.1 何を消すか

`/api/maintenance/cleanup` は次を削除します。

- `ConversationLog.rawTextOriginal`
- `ConversationLog.rawTextCleaned`
- `ConversationLog.rawSegments`

削除条件:

- `rawTextExpiresAt <= now`

### 20.2 何を消さないか

- summaryMarkdown
- timeline / nextActions / profileDelta など生成済み成果物
- Report 本文

### 20.3 音声ファイル

- 元音声は DB に保存していない
- cleanup 対象は transcript 側の raw 情報

## 21. API 一覧

### 21.1 認証

- `POST /api/auth/login`
- `GET/POST /api/auth/[...nextauth]`

### 21.2 生徒

- `GET/POST /api/students`
- `GET/PUT /api/students/[id]`
- `GET /api/students/[id]/room`
- `GET/POST/PATCH/DELETE /api/students/[id]/recording-lock`

### 21.3 セッション

- `GET/POST /api/sessions`
- `GET/PATCH /api/sessions/[id]`
- `POST /api/sessions/[id]/parts`
- `POST /api/sessions/[id]/generate`
- `PATCH /api/sessions/[id]/entities/[entityId]`

### 21.4 会話ログ

- `GET/POST /api/conversations`
- `GET/PATCH/DELETE /api/conversations/[id]`
- `POST /api/conversations/[id]/regenerate`
- `POST /api/conversations/[id]/format`
- `POST /api/audio` (session 非依存の直接 audio ingest)

#### 会話ログ API の特殊挙動

- `GET /api/conversations/[id]?brief=1`
  - ポーリング用の簡易レスポンス
- `GET /api/conversations/[id]?process=1`
  - バックグラウンド処理を再キックしつつ取得
- `POST /api/conversations/[id]/regenerate`
  - 既存 artifacts と jobs を消して再実行
- `POST /api/conversations/[id]/format`
  - transcript 整形 job だけ追加
- `DELETE /api/conversations/[id]`
  - linked session がある場合、その session を `DRAFT` に戻す

### 21.5 保護者レポート

- `POST /api/ai/generate-report`
- `POST /api/reports/[id]/send`

### 21.6 補助 AI 入口

- `POST /api/ai/analyze-conversation`
  - transcript をその場で構造化する旧 / 補助 API
  - `save=false` なら即時分析のみ
  - `save=true` かつ `organizationId`, `studentId` が揃えば ConversationLog を直接保存

### 21.7 招待

- `GET/POST /api/invitations`
- `POST /api/invitations/accept`

### 21.8 ジョブ / メンテナンス

- `GET/POST /api/jobs/run`
- `POST /api/jobs/conversation-logs/process`
- `GET/POST /api/maintenance/cleanup`

### 21.9 Student Room 用集約 API

- `GET /api/students/[id]/room`
  - 生徒詳細ページ用の集約レスポンス
  - `student`, `latestConversation`, `latestProfile`, `sessions`, `reports`, `recordingLock` をまとめて返す
  - conversation には `operationalLog` と `operationalSummaryMarkdown` も導出して載せる

## 22. 環境変数

### 22.1 必須

- `DATABASE_URL`
- `AUTH_SECRET`
- `OPENAI_API_KEY` または `LLM_API_KEY` / `STT_API_KEY`

### 22.2 ほぼ必須

- `DIRECT_URL` (Prisma 直接接続用)
- `LLM_MODEL`, `LLM_MODEL_FAST`, `LLM_MODEL_FINAL`
- `STT_MODEL`, `STT_FALLBACK_MODEL`

### 22.3 重要なチューニング

- `JOB_CONCURRENCY`
- `ENABLE_SINGLE_PASS_MODE`
- `SINGLE_PASS_MAX_BLOCKS`
- `SINGLE_PASS_MAX_CHARS`
- `SINGLE_PASS_STRUCTURED_SUMMARY`
- `LLM_CALL_TIMEOUT_MS`
- `ANALYZE_MAX_TOKENS`
- `ANALYZE_BATCH_MAX_TOKENS`
- `REDUCE_MAX_TOKENS`
- `FINALIZE_MAX_TOKENS`
- `SINGLE_PASS_MAX_TOKENS`
- `RECORDING_MIN_DURATION_SECONDS`
- `TRANSCRIPT_MIN_SIGNIFICANT_CHARS`
- `RECORDING_REQUIRE_KNOWN_DURATION`
- `AUDIO_RETAIN_DAYS`
- `INVITATION_EXPIRES_DAYS`

### 22.4 運用系

- `BASIC_AUTH_USER`
- `BASIC_AUTH_PASS`
- `CRON_SECRET`
- `NEXTAUTH_URL`

## 23. 開発手順

### 23.1 セットアップ

```bash
npm install
npx prisma generate
npx prisma migrate deploy
npm run prisma:seed
npm run dev
```

### 23.2 seed データ

`prisma/seed.ts` は次を作ります。

- demo organization: `org-demo`
- demo users:
  - `admin@demo.com / demo123`
  - `manager@demo.com / demo123`
  - `teacher@demo.com / demo123`
  - `instructor@demo.com / demo123`
- demo students:
  - `Hana Yamada`
  - `Aoi Sato`
- interview / lesson / report のサンプルデータ

### 23.3 検証コマンド

```bash
npm run typecheck
npm run lint
npm run build
npm run verify
```

## 24. デプロイ / 本番運用

### 24.1 最低限必要なこと

1. `.env.example` を基に env を揃える
2. `npx prisma migrate deploy`
3. `npm run build`
4. cron を有効にする

### 24.2 本番での注意

- `AUTH_SECRET` は必須
- `CRON_SECRET` を設定し、cron 実行だけを通す
- Basic Auth を使う場合は `BASIC_AUTH_USER/PASS` を設定
- report send は manual 記録だけなので、実メール導線は別途必要

## 25. 現在の制約 / 未実装

ここは README に残しておくべき重要事項です。

1. 外部 durable queue は未採用
- conversation jobs は DB ベースの runner です
- Vercel Workflow / Blob への移行はまだ

2. 音声ファイル自体は保存していない
- transcript とメタだけ保存します

3. 保護者レポート送信は manual
- status 更新のみ
- 実メール / LINE / SMS 送信は未実装

4. テーマ設定は端末ローカル
- サーバー同期なし

5. Settings の一部は下書き UI
- 組織情報や保持方針は画面上の整備が中心
- すべてが永続設定 API に繋がっているわけではない

## 26. 実装されているが見落としやすい仕様

最後に、見落としやすいけれど README から外してはいけない点をまとめます。

- Session と ConversationLog は別モデル
- 1 Session に対して 1 ConversationLog
- 指導報告は `CHECK_IN + CHECK_OUT` が揃って初めて生成
- direct audio (`/api/audio`) と direct transcript (`/api/conversations POST`) の旧経路もまだ生きている
- transcript の raw 情報には TTL がある
- single-pass と 3 段 job の両方がある
- summary はそのまま見せず、OperationalLog に再構成してから UI に出す
- 保護者レポートは selected logs only
- pending entity がある report は送れない
- 録音ロックは heartbeat 付き
- `/app/logs` と `/app/reports` は主導線ではなく補助面

---

## 付録: どこを見れば何が分かるか

- 認証: `auth.ts`, `middleware.ts`, `app/api/auth/*`
- スキーマ: `prisma/schema.prisma`
- seed: `prisma/seed.ts`
- STT: `lib/ai/stt.ts`
- transcript 前処理: `lib/transcript/preprocess.ts`
- 会話生成: `lib/ai/conversationPipeline.ts`
- transcript 整形: `lib/ai/llm.ts`
- 保護者レポート: `lib/ai/parentReport.ts`
- OperationalLog: `lib/operational-log.ts`
- プロフィール更新: `lib/profile.ts`
- セッション統合: `lib/session-service.ts`
- 録音ロック: `lib/recording/lockService.ts`
- 録音バリデーション: `lib/recording/validation.ts`
- job runner: `lib/jobs/conversationJobs.ts`
- 生徒詳細 UI: `app/app/students/[studentId]/page.tsx`
