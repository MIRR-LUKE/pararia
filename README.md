# PARARIA SaaS v0.2（会話ログ蓄積特化版）

「録音→構造化会話ログ→カルテ自動更新→ワンタッチ保護者レポート」を最短動線で実現する学習塾向けAIダッシュボード。

## 価値提案（v0.2）
- 録音ボタンを押すだけで完結（先生の負担極小）。
- raw transcriptは保存せず、構造化データのみをDBに格納。
- 雑談も含めた会話が溜まるほどカルテが自動で充実。
- ワンタッチで保護者レポート生成（前回レポ参照＋前回以降ログの自動選択）。PDF出力対応。
- 指標は「最終会話からの日数」「会話ログ件数」「カルテ充実度」。モチベ/リスクは補助指標。

## 技術スタック
- Next.js 14 (App Router), React 18, TypeScript, CSS Modules
- Prisma 5 + PostgreSQL
- bcryptjs
- PDFKit（サーバーで簡易PDF生成）

## データベーススキーマ（主要）
- **Organization**: `id`, `name`, `reports[]`, timestamps
- **User**: `id`, `email`, `passwordHash`, `name`, `role (ADMIN|TEACHER)`, `organizationId`
- **Student**: `id`, `organizationId`, `name`, `grade`, `course?`, `enrollmentDate?`, `birthdate?`, `guardianNames?`, timestamps, `reports[]`
- **StudentProfile**: 既存フィールド + `profileData Json?`（personal/basicのスナップショット）
- **ConversationLog**: `summary`, `keyQuotes Json?`, `keyTopics Json?`, `nextActions Json?`, `structuredDelta Json?`, `sourceType`, timestamps（※rawTextなし）
- **Report**: `markdown`, `json?`, `pdfBase64?`, `periodFrom/To?`, `sourceLogIds Json?`, timestamps
- **Enums**: `UserRole (ADMIN|TEACHER)`, `ConversationSourceType (MANUAL|AUDIO)`, `DropoutRiskLevel (LOW|MEDIUM|HIGH)`

## API（v0.2仕様）
- `POST /api/auth/login` : email/passwordでログイン（セッション発行は未実装）
- `GET /api/students` : 生徒一覧取得
- `POST /api/students` : 生徒作成（氏名・学年必須、入塾日/生年月日/保護者氏名は任意）
- `POST /api/conversations`
  - transcriptがあればLLM構造化→保存
  - もしくは summary/keyQuotes/keyTopics/nextActions/structuredDelta を直接保存
  - 戻り値: 構造化された会話ログ（rawなし）
- `POST /api/audio`
  - 音声を受信→STT→LLMで構造化→ConversationLog保存→StudentProfileへ差分反映
  - 戻り値: conversationId, summary, keyQuotes, keyTopics, nextActions, structuredDelta
- `POST /api/ai/analyze-conversation`
  - transcriptを構造化（save=falseで試算、save=true+IDsで保存）
- `POST /api/ai/generate-report`
  - デフォルト: 前回レポ以降の全ログを自動選択（logIds指定も可）
  - 生成物を`Report`に保存（markdown, pdfBase64, sourceLogIds, periodFrom/To）

## フロントエンド（主要画面）
- `/app/students` 生徒一覧
  - 検索: 氏名
  - ソート: 最終会話の新旧 / 会話ログ件数
  - 表示: 生徒名・学年 / 最終会話からの日数 / ログ件数 / カルテ充実度% / CTA「録音して会話ログ追加」「ワンタッチ保護者レポート」
  - 生徒追加フォーム（簡潔: 氏名・学年・入塾日・生年月日・保護者氏名）
- `/app/students/[id]` 生徒詳細（タブ廃止・縦統合）
  - 上部: 録音UI（録音→文字起こし→構造化→即時保存）
  - カルテ: パーソナル/基本情報（値・最終更新・根拠logId）。会話が増えると自動で育つ。
  - 会話ログ: summary / keyQuotes / keyTopics / nextActions / カルテ更新差分（全文表示なし）
  - 保護者レポート: メインCTA「ワンタッチ生成」、サブ「ログを選んで生成」。Markdown+PDFプレビュー/履歴。
- `/app/logs/[logId]` 会話ログ詳細（構造化のみ表示）
- `/app/reports` 生徒別レポート一覧（最新日付・次回推奨・ワンタッチ生成）

## ライブラリ・ユーティリティ
- `lib/ai/llm.ts`
  - `structureConversation(transcript)` : summary / keyQuotes / keyTopics / nextActions / structuredDelta（モック可、rawを保持しない）
  - `generateParentReportMarkdown(input)` : 前回レポ参照 + 期間情報を加味したMarkdown生成（LLM未接続時はモック）
- `lib/analytics/conversationAnalysis.ts`
  - `createStructuredConversationLog({ transcript, ... })` : STT結果から構造化ログを保存し、カルテ差分を適用
- `lib/profile.ts`
  - `applyProfileDelta(studentId, delta, conversationId)` : profileData Jsonをマージし最終更新・根拠を保持
- `lib/pdf/report.ts`
  - `generateReportPdfBase64(input)` : Markdownを簡易PDFに変換（PDFKit）
- `lib/ai/stt.ts` : STTモック（APIキー未設定時はデモ文字起こし）
- `lib/mockData.ts` : 構造化会話ログ＆カルテ差分を持つデモデータ

## 環境変数
`.env.local` をプロジェクト直下に作成して設定します（雛形は `config/env.example`）。

```env
DATABASE_URL="postgresql://user:password@localhost:5432/pararia?schema=public"
OPENAI_API_KEY="sk-..."  # STT(Whisper)に使用
```

## セットアップ
```bash
npm install
npm run prisma:generate
npm run prisma:migrate
npm run dev   # http://localhost:3000
```

## データ保持ポリシー（v0.2）
- raw transcriptはDBに保存しない。保存するのは構造化データのみ。
- カルテは `structuredDelta` をマージして自動更新（最終更新日・根拠logIdを保持）。
- 音声ファイルの保持期間設定UIはあり（削除ロジックはTODO）。

## 既知の課題 / TODO
- 認証セッション未実装（JWT/Cookie導入予定）
- LLM/STTの実API連携はモック（トークン最適化プロンプト要）
- PDFテンプレは簡易版（デザイン強化・署名欄などは今後）
- テスト未整備
- エラーハンドリング・レート制限強化

## バージョン
- v0.2.0（会話ログ蓄積・カルテ自動更新・PDFレポートの導線刷新）

