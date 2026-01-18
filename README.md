# PARARIA SaaS（現状実装まとめ）

学習塾向けの「録音 → 会話ログ → カルテ更新 → 保護者レポート」を最短導線で回すダッシュボード。
本READMEは **現在の実装状態（UI / API / DB / Jobs）** を正確にまとめたものです。

---

## 主要フロー（実装済み）

1) **録音 / 音声アップロード → 会話ログ作成**
- 生徒詳細の `StudentRecorder` で **録音 / 音声ファイルアップロード** に対応（MediaRecorder + File Upload）。
- `POST /api/audio` で **Whisper (verbose_json)** を実行。
- 前処理（フィラー除去 / 連続重複整理 / 段落化 / 話題境界推定 / chunk作成）。
- `ConversationLog` を **status=PROCESSING** で保存し、`rawTextOriginal/rawTextCleaned/rawSegments` をTTL付きで保持。
- `ConversationJob` を **SUMMARY/EXTRACT/MERGE/FORMAT** の4本でキュー投入（即レス）。

2) **会話ログの構造化（分割→並列→統合）**
- Step1: chunkごとに **メモ生成**（デフォルト4o-mini、長文は4o）。
- Step2: **4oで統合**し、Summary / Timeline / ToDo / ProfileDelta を確定稿で生成。
- Step3: **formattedTranscript** を整形（ルール整形 + 4o-mini補正 + 4o最終整合）。
- 生成完了で **status=DONE**。`rawTextCleaned` は即削除、rawはTTLで削除。
- Jobsは **並列実行**（同時進行数は `JOB_CONCURRENCY` で調整）。

3) **会話ログ詳細（編集・再生成・削除）**
- `/app/logs/[logId]` で **Summary / Timeline / ToDo / 全文** を表示。
- `PATCH /api/conversations/[id]` で **Summary編集**。
- `POST /api/conversations/[id]/regenerate` で **再生成**（SUMMARY/EXTRACT/MERGE/FORMAT再投入）。
- `DELETE /api/conversations/[id]` で **削除**。

4) **カルテ更新（basic/personal）**
- LLM抽出した **ProfileDelta** を `applyProfileDelta` で `StudentProfile.profileData` に反映。
- `basic/personal` は **配列形式**（field/value/confidence/evidence_quotes）。

5) **保護者レポート生成（API + UI）**
- `POST /api/ai/generate-report` で **Markdown + JSON + PDF(base64)** を生成。
- ログ複数選択 + 前回レポ参照トグルあり。
- `Report` に保存（`previousReportId` 参照あり）。

---

## 画面一覧（UI実装状況）

- `/login` : デモログイン画面（認証は未接続）。
- `/app/dashboard` : KPI/チャート（**mockData依存**）。
- `/app/students` : **DB接続済み**（一覧/検索/新規追加）。
- `/app/students/[id]` :
  - 録音/アップロード → `/api/audio` 連携
  - 会話ログ一覧（`/api/conversations`）
  - 生徒基本情報編集UI（`PUT /api/students/[id]`）
  - 保護者レポート生成UI（`/api/ai/generate-report`）
- `/app/logs/[logId]` : 会話ログ詳細（**DB連携**）
- `/app/reports` : 保護者レポートダッシュボード（**mockData依存**）
- `/app/reports/[studentId]` : レポート詳細（**mockData依存**）
- `/app/settings` : 塾情報・保持ポリシー（**ローカル状態のみ**）

---

## API一覧（現状）

- `POST /api/audio` : 音声→STT→会話ログ作成→Jobs投入
- `POST /api/jobs/run?limit=N` : キュー実行（手動/デバッグ用）
- `POST /api/jobs/run?limit=N&concurrency=M` : 並列実行対応
- `POST /api/jobs/conversation-logs/process` : 旧互換（limit/concurrency可）
- `POST /api/maintenance/cleanup` : TTL削除（rawText* を掃除）
- `GET /api/conversations?studentId=...` : 会話ログ一覧
- `POST /api/conversations` : 手入力ログ作成（Jobs投入）
- `GET /api/conversations/[id]` : 会話ログ取得
- `PATCH /api/conversations/[id]` : 会話ログ更新
- `DELETE /api/conversations/[id]` : 会話ログ削除
- `POST /api/conversations/[id]/regenerate` : 再生成
- `POST /api/ai/generate-report` : 保護者レポート生成 + PDF
- `GET /api/students` : 生徒一覧（DB）
- `POST /api/students` : 生徒作成（DB）
- `GET /api/students/[id]` : 生徒詳細（DB）
- `PUT /api/students/[id]` : 生徒情報更新（DB）

---

## LLM / STT設計（品質 × 速度）

- **STT**: OpenAI Whisper API（`verbose_json`）
- **チャンク**: 2,000〜3,200 tokens相当、話題境界 + 段落 + 最大長
- **Step1（メモ）**: 4o-mini（30分以上 or 20,000文字超は4o）
- **並列実行**: `JOB_CONCURRENCY` を超えない範囲で同時にジョブ実行
- **Step2（統合）**: 4oで最終稿（Summary/Timeline/ToDo/ProfileDelta）
- **Step3（整形）**: ルール整形 + 4o-mini補正 + 4o整合
- **TTL**: rawTextOriginal/rawTextCleaned/rawSegments は 30日。成果物は永続保持。

---

## DB主要スキーマ（現状）

- **Student / StudentProfile**: `profileData` に basic/personal を配列で保持
- **ConversationLog**:
  - rawTextOriginal/rawTextCleaned/rawSegments + rawTextExpiresAt
  - summaryMarkdown / timelineJson / nextActionsJson / profileDeltaJson / formattedTranscript
  - status（PROCESSING/PARTIAL/DONE/ERROR）
- **ConversationJob**: SUMMARY/EXTRACT/MERGE/FORMAT/REPORT
- **Report**: reportMarkdown / reportJson / reportPdfBase64 / previousReportId

---

## 認証 / Cron

- **Basic Auth**: `middleware.ts` で `/app` `/api` を保護
- **Jobs Cron**: `vercel.json` から `/api/jobs/run?limit=6&concurrency=3&cron_secret=...` を毎分実行
- **Cleanup Cron**: `vercel.json` から `/api/maintenance/cleanup` を定期実行

---

## 環境変数（例）

```env
DATABASE_URL="postgresql://user:password@localhost:5432/pararia?schema=public"
OPENAI_API_KEY="sk-..."  # STT/LLM
LLM_API_KEY="sk-..."     # 省略時はOPENAI_API_KEYを使用
BASIC_AUTH_USER="demo"
BASIC_AUTH_PASS="demo"
CRON_SECRET="change-me"
JOB_CONCURRENCY="3"
```

---

## 未接続 / 制約

- ダッシュボード / レポート画面は **mockData依存**
- `/login` はデモUIのみ（認証はBasic Authで代替）
- cronは `CRON_SECRET` 設定が必要
