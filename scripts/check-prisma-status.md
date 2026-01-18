# Prisma & 会話ログ生成フロー確認レポート

## ✅ 確認完了項目

### 1. Prismaスキーマ
- ✅ `ConversationLog` に `summaryMarkdown / timelineJson / nextActionsJson / profileDeltaJson / formattedTranscript` を保持
- ✅ `ConversationLog.status` が PROCESSING/PARTIAL/DONE/ERROR
- ✅ `ConversationJob` が SUMMARY/EXTRACT/MERGE/FORMAT/REPORT

### 2. LLM処理
- ✅ チャンク分割（話題境界 + 段落 + 最大長）
- ✅ Step1: chunkメモ生成（4o-mini / 長文は4o）
- ✅ Step2: 4o統合で Summary/Timeline/ToDo/ProfileDelta を確定
- ✅ Step3: formattedTranscript 整形

### 3. データベース保存
- ✅ `createStructuredConversationLog` が Summary/Timeline/ToDo/ProfileDelta を保存
- ✅ ProfileDelta を StudentProfile.profileData に反映

### 4. APIエンドポイント
- ✅ `/api/audio` (POST): 会話ログ作成 + Jobs投入
- ✅ `/api/conversations` (GET/POST)
- ✅ `/api/conversations/[id]` (GET/PATCH/DELETE)
- ✅ `/api/conversations/[id]/regenerate` (POST)
- ✅ `/api/jobs/run` (POST): 手動ジョブ実行
- ✅ `/api/maintenance/cleanup` (POST): TTL掃除

### 5. フロントエンド
- ✅ `LogDetailView.tsx`: Summary/Timeline/ToDo/全文 表示
- ✅ 生徒詳細でログ生成 / レポート生成

---

## 🎯 結論

**MVPの会話ログ生成フローは分割→並列→統合の設計で成立しています。**

- Summary/Timeline/ToDo/ProfileDelta が保存
- formattedTranscript の可読性を重視して保持
- rawText* はTTLで削除
