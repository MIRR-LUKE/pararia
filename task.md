# MVPタスク整理（現状 → MVP到達）

## MVP仕様
1. 生徒ごとに録音/音声アップロードで会話ログ生成 → パーソナルデータが更新・蓄積されること
2. ワンタッチで保護者レポートをテキスト生成できること（プロンプト品質含む）
   - ソースは自分で選択できる会話ログ範囲
3. 生徒の基本情報を編集できること
4. コストを抑えつつ品質とスピードを上げるLLM API設計（分割→並列→統合）

---

## 実装状況

### ✅ 実装済み
- 録音/アップロード → `/api/audio` → 会話ログ作成（PROCESSING）
- 分割→並列→統合のジョブ設計（CHUNK_ANALYZE/REDUCE/FINALIZE、FORMATは任意）
- Summary/Timeline/ToDo/ProfileDelta/ParentPack の生成・保存
- ProfileDelta を StudentProfile.profileData に反映
- 生徒基本情報の編集UI（`PUT /api/students/[id]`）
- 保護者レポート生成UI（ログ複数選択＋前回参照トグル）
- 保護者レポート生成API（Markdown + JSON、PDFなし）

### 🟡 部分実装
- cron/cleanup
  - `/api/maintenance/cleanup` は実装済み
  - Vercel Cron を有効化するには `CRON_SECRET` 設定が必要

### ❌ 未実装 / 後回し
- ダッシュボード / レポートページは mockData 依存
- 認証は Basic Auth のみ（本格Authは未接続）

---

## リリース前の作業（手順）
1. README / task.md 更新（実行中）
2. 旧参照の一掃（SUMMARY/EXTRACT/MERGE/PDF 参照の削除）
3. Prisma migrate reset 実行
4. `npm run lint` / `npm run build` 実行
