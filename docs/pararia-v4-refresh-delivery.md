# PARARIA v4 Refresh Delivery

## 1. 今回の刷新で固定したこと

今回の実装では、PARARIA の中核を `録音アプリ` ではなく `会話ログ起点の Teaching OS` に寄せ直した。

特に以下を固定した。

- 保護者レポートは `ログ選択後に初めて生成` する
- 会話ログは `テーマ / 事実 / 変化 / 見立て / 次確認 / 親共有 / entity` の順に再構成する
- ログ詳細は `Proof Surface` として、`要点 → 根拠 → entity → 文字起こし` の順に見る
- Student Room から `レポ素材選択` に直接進める
- 未確認 entity が残るレポートは API 側でも送付できない

## 2. 実装した主要機能

### 2-1. 運用可能な会話ログの共通レイヤー

新規追加:

- `lib/operational-log.ts`

このモジュールで以下を共通化した。

- `buildOperationalLog`
- `renderOperationalSummaryMarkdown`
- `buildReuseBlocks`
- `buildBundleQualityEval`
- `buildBundlePreview`

これにより、生成保存・API返却・UI表示が同じロジックを見るようになった。

### 2-2. 会話生成保存時の標準化

更新:

- `lib/jobs/conversationJobs.ts`
- `lib/analytics/conversationAnalysis.ts`

`single-pass` と通常 `finalize` の両方で、LLM の生 summary をそのまま保存せず、共通ヘルパーで v4 形式に再構成して保存するよう変更した。

### 2-3. 保護者レポート生成の刷新

新規追加:

- `lib/ai/parentReport.ts`

更新:

- `app/api/ai/generate-report/route.ts`

変更点:

- 旧来の浅い report prompt を廃止
- `選択ログ + 束ね品質評価 + 最新プロフィール` を入力にして生成
- 出力を
  - 挨拶
  - 今回の様子
  - 学習状況の変化
  - 講師としての見立て
  - 科目別またはテーマ別の具体策
  - リスクとその意味
  - 次回までの方針
  - ご家庭で見てほしいこと
  に固定
- `qualityChecksJson` に `bundleQualityEval` を保存

### 2-4. Report Builder を仕様どおりに再構築

更新:

- `app/app/reports/[studentId]/page.tsx`
- `app/app/reports/[studentId]/report.module.css`

変更点:

- 自動生成を廃止
- 左: 候補ログ一覧
- 中央: 束ねプレビュー + 品質評価 + 生成済みドラフト
- 右: entity確認 / 警告 / 追加候補 / 生成・送付

### 2-5. Student Room からログ選択へつなぐ導線

更新:

- `app/api/students/[id]/room/route.ts`
- `app/app/students/[studentId]/page.tsx`
- `app/app/students/[studentId]/studentDetail.module.css`

変更点:

- 各 session の `operationalLog` と `operationalSummaryMarkdown` を返却
- Student Room に `Communication / レポ素材` セクションを追加
- ここでログを選んでそのまま Report Builder に渡せるようにした

### 2-6. Proof Surface の再構築

更新:

- `app/api/conversations/[id]/route.ts`
- `app/app/logs/LogDetailView.tsx`
- `app/app/logs/[logId]/logDetail.module.css`

変更点:

- API が `operationalLog / operationalSummaryMarkdown / reuseBlocks` を返す
- UI を `要点 / 根拠 / 要確認 entity / 文字起こし` に整理
- transcript を最後のタブへ後退

### 2-7. 録音時間の上限

更新:

- `app/app/students/[studentId]/StudentRecorder.tsx`
- `app/app/students/[studentId]/LessonReportComposer.tsx`

変更点:

- 面談録音: 60分で自動停止
- 指導報告 check-in / check-out: 10分で自動停止

### 2-8. 送付制御の強化

更新:

- `app/api/reports/[id]/send/route.ts`

変更点:

- `qualityChecksJson.pendingEntityCount > 0` の場合は送付を `409` で拒否

## 3. 変更ファイル一覧

- `lib/operational-log.ts`
- `lib/jobs/conversationJobs.ts`
- `lib/analytics/conversationAnalysis.ts`
- `lib/ai/parentReport.ts`
- `app/api/ai/generate-report/route.ts`
- `app/api/students/[id]/room/route.ts`
- `app/api/conversations/[id]/route.ts`
- `app/api/reports/[id]/send/route.ts`
- `app/app/reports/[studentId]/page.tsx`
- `app/app/reports/[studentId]/report.module.css`
- `app/app/students/[studentId]/page.tsx`
- `app/app/students/[studentId]/studentDetail.module.css`
- `app/app/logs/LogDetailView.tsx`
- `app/app/logs/[logId]/logDetail.module.css`
- `app/app/students/[studentId]/StudentRecorder.tsx`
- `app/app/students/[studentId]/LessonReportComposer.tsx`

## 4. 動作確認

以下を通した。

- `npm run typecheck`
- `npm run lint`
- `npm run build`

## 5. 現時点の補足

- 会話ログの標準構造は、DB schema を増やさず `既存JSON + 派生ロジック` で実装している
- そのため migration 追加なしで反映できる
- 既存データも、再生成または API 表示時の派生で v4 形式に寄せられる

## 6. 次に見るべき確認ポイント

実機確認では以下を見るとよい。

1. Student Room の `Communication / レポ素材` から複数ログ選択できるか
2. Report Builder で `束ね品質` と `追加候補` が自然に出るか
3. 会話ログ詳細で transcript が最後に退いているか
4. 未確認 entity がある状態で送付 API が止まるか
5. 面談60分 / 指導報告10分の自動停止が意図どおり動くか
