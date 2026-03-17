# PARARIA v4 Refresh Delivery

## 概要

今回の刷新では、PARARIA の主導線を `Today / Students / Admin` の 3 つに絞り、実務の中心を `Student Room` に集約しました。録音、処理進行確認、根拠確認、保護者レポート生成、送付前確認までを、生徒の文脈を切らずに 1 画面で進められる構造へ変更しています。

## 今回の刷新で変えたこと

### 1. Student Room を唯一の作業面に再構成

対象:
- `app/app/students/[studentId]/page.tsx`
- `app/app/students/[studentId]/studentDetail.module.css`

変更点:
- 長い縦積み構造を廃止
- 左を `Main Surface`、右を `Workbench` とする 2 面構成へ変更
- 上部に `Sticky Context Bar` を追加し、主 CTA を常に 1 本だけ表示
- Main Surface には以下を配置
  - Hero
  - Next Best Action
  - Profile Snapshot
  - Session Stream
- Workbench には以下の状態を集約
  - `idle`
  - `recording`
  - `proof`
  - `report_selection`
  - `report_generated`
  - `send_ready`
  - `error`

### 2. 録音 UI を 1 つの Session Console に統合

新規:
- `app/app/students/[studentId]/StudentSessionConsole.tsx`
- `app/app/students/[studentId]/studentSessionConsole.module.css`

既存活用:
- `app/app/students/[studentId]/StudentRecorder.tsx`
- `app/app/students/[studentId]/LessonReportComposer.tsx`

変更点:
- 面談と指導報告の入口を 1 面に統合
- 指導報告は `チェックイン / チェックアウト` の切替を Session Console 上で制御
- 旧 `scrollIntoView` ベースの導線を廃止
- 録音完了後は Student Room 内の Proof / Report 導線へ戻せるように変更

### 3. Session Stream を中央の共通素材面に変更

新規:
- `app/app/students/[studentId]/StudentSessionStream.tsx`
- `app/app/students/[studentId]/studentStream.module.css`

変更点:
- 面談と指導報告を同じ一覧に統合
- 1 ログカードで以下を確認可能に変更
  - 今回の会話テーマ
  - 事実
  - 変化
  - 見立て
  - 次に確認すること
  - 親共有に向く要素
  - 未確認 entity 件数
- レポ素材選択を一覧上で完結できるように変更
- ログ選択時に Workbench の Report Studio が開くように変更

### 4. Proof Console を Student Room 内へ移植

新規:
- `app/app/students/[studentId]/StudentWorkbench.tsx`

既存埋め込み:
- `app/app/logs/LogDetailView.tsx`

変更点:
- `/app/logs/[logId]` を主導線から外し、Student Room 右ワークベンチ内で表示
- `要点 / 根拠 / entity / 文字起こし` を、Student Room の文脈のまま確認できるように変更

### 5. Report Studio を Student Room 内へ移植

新規:
- `app/app/students/[studentId]/ReportStudio.tsx`
- `app/app/students/[studentId]/studentWorkbench.module.css`

変更点:
- `/app/reports/[studentId]` の Builder を主導線から外し、右ワークベンチへ移植
- 左の Session Stream を見ながら右で以下を確認できるように変更
  - 選択ログ数
  - 束ね品質
  - 弱い要素
  - 追加候補
  - 未確認 entity
  - 生成後ドラフト
  - 送付前チェック
- 生成後の送付準備完了まで同一面で完結

### 6. Student ごとの Queue Dock を追加

新規:
- `app/app/students/[studentId]/StudentQueueDock.tsx`

変更点:
- 右ワークベンチ上部に、その生徒だけの進行状況を集約
- 以下を優先順で表示
  - check-out 待ち
  - 生成中
  - entity 確認待ち
  - レポ確認待ち

### 7. Sidebar から Reports を外し、Queue 指標へ変更

対象:
- `components/layout/Sidebar.tsx`
- `components/layout/Sidebar.module.css`

変更点:
- 主ナビを `Today / Students / Admin` の 3 つに固定
- `Reports` は主導線から外し、補助確認面として Queue カードから入る構成に変更
- 処理中 / 要確認 / 送付待ち の件数を Sidebar で確認可能に変更

### 8. 旧詳細ルートは Student Room にリダイレクト

対象:
- `app/app/reports/[studentId]/page.tsx`
- `app/app/logs/[logId]/page.tsx`

変更点:
- `/app/reports/[studentId]` -> `/app/students/[studentId]?panel=report`
- `/app/logs/[logId]` -> `/app/students/[studentId]?panel=proof&logId=...`
- 旧 URL は互換性を保ちつつ、主導線は Student Room に統一

## 追加した主なファイル

- `app/app/students/[studentId]/roomTypes.ts`
- `app/app/students/[studentId]/StudentSessionConsole.tsx`
- `app/app/students/[studentId]/StudentSessionStream.tsx`
- `app/app/students/[studentId]/StudentQueueDock.tsx`
- `app/app/students/[studentId]/StudentWorkbench.tsx`
- `app/app/students/[studentId]/ReportStudio.tsx`
- `app/app/students/[studentId]/studentSessionConsole.module.css`
- `app/app/students/[studentId]/studentStream.module.css`
- `app/app/students/[studentId]/studentWorkbench.module.css`

## 更新した主なファイル

- `app/app/students/[studentId]/page.tsx`
- `app/app/students/[studentId]/LessonReportComposer.tsx`
- `app/app/students/[studentId]/StudentRecorder.tsx`
- `app/app/students/[studentId]/studentDetail.module.css`
- `components/layout/Sidebar.tsx`
- `components/layout/Sidebar.module.css`
- `app/app/reports/[studentId]/page.tsx`
- `app/app/logs/[logId]/page.tsx`

## 動作確認

実施済み:
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npx prisma validate`
- `npx prisma migrate status`

すべて成功しています。

## 追加で行った hardening

### 1. レスポンシブ調整

- `Student Room` はモバイル時に `Workbench` が縦積みになるため、パネルを開いたときに自動で Workbench までスクロールするように調整
- `Sticky Context Bar` はモバイルでは `position: static` に切り替え
- `safe-area-inset-bottom` を考慮した下部余白を追加
- `Today / Students / Reports` の小画面崩れを調整
- フィルタチップ、録音ボタン、停止ボタンに `focus-visible` を追加

対象:
- `app/app/students/[studentId]/page.tsx`
- `app/app/students/[studentId]/studentDetail.module.css`
- `app/app/dashboard/dashboard.module.css`
- `app/app/students/students.module.css`
- `app/app/reports/reportDashboard.module.css`
- `app/app/students/[studentId]/studentRecorder.module.css`

### 2. DB / Prisma 周り

- `DIRECT_URL` 未設定で `prisma validate` と `migrate status` が落ちていたため、ローカル環境の接続設定を補完
- Prisma schema と migration 状態を再確認し、DB が最新 migration に追随していることを確認

### 3. 旧導線のリンク整理

- `Today` と `Students` のリンクを新しい `panel` ベース導線へ更新
- `Reports` 補助面のカードリンクも `Student Room` 中心の導線へ更新
- `StudentRecorder` / `LessonReportComposer` のフォールバックリンクも `Student Room` 内 Proof に変更
- `/app/students/[studentId]/logs/[logId]` を `Student Room` 内 Proof へリダイレクト
- `/app/students/[studentId]/sessions/new` を `Student Room` 内 recording panel へリダイレクト

対象:
- `app/app/dashboard/page.tsx`
- `app/app/students/page.tsx`
- `app/app/reports/page.tsx`
- `app/app/students/[studentId]/StudentRecorder.tsx`
- `app/app/students/[studentId]/LessonReportComposer.tsx`
- `app/app/students/[studentId]/logs/[logId]/page.tsx`
- `app/app/students/[studentId]/sessions/new/page.tsx`

## HTTP スモーク確認

認証済みセッションを取得したうえで、ビルド済みアプリを一時起動して以下を確認済みです。

- `/app/dashboard` -> `200`
- `/app/students/[studentId]` -> `200`
- `/app/reports/[studentId]` -> `307` で `/app/students/[studentId]?panel=report`
- `/app/logs/[logId]` -> `307` で `/app/students/[studentId]?panel=proof&logId=...`
- `/app/students/[studentId]/logs/[logId]` -> `307` で `/app/students/[studentId]?panel=proof&logId=...`
- `/app/students/[studentId]/sessions/new` -> `307` で `/app/students/[studentId]?panel=recording&mode=INTERVIEW`

## いまの主導線

### 講師の通常導線
1. `Today` または `Students` から生徒を開く
2. `Student Room` で面談または授業を始める
3. 録音停止後、そのまま右ワークベンチで進行を見る
4. 必要なら Proof を開いて entity や根拠を確認する
5. Session Stream でログを選び、右ワークベンチで保護者レポートを束ねる
6. 送付前確認を終えて送付準備完了にする

### 補助導線
- `/app/reports` は review queue の補助面
- `/app/logs` は根拠確認の補助面
- どちらも主導線ではなく、補助確認面として残しています

## 補足

今回の刷新は、機能追加よりも「文脈を切らないこと」を優先した再構成です。思想は既存実装に近いまま、面を統合し、講師の頭の中で 1 本につながる UI へ寄せています。
