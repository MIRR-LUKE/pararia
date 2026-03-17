# UX/UI Phase 4 納品報告

更新日: 2026-03-15
対象: `docs/uxui-zero-based-redesign.md` の Phase 1 から Phase 4 までの実装

## 1. 今回の到達点
PARARIA の教師向け UI を、情報閲覧中心の管理画面から、次の行動を進める Teaching OS として再設計した。

今回の実装で、以下を完了した。

- `Today` を行動キュー化
- `Students` を検索用ディレクトリ化
- `Student Room` を主導線化
- 面談録音面を one-tap 前提で整理
- 指導報告を 2-step session surface 化
- レポート画面を review queue 化
- `Proof Surface` を独立した根拠確認面として再設計
- ライト / ダークのトークンと設定 override を実装
- Review Queue を Reports 以外にも広げた
- 旧設計の dead code と旧セッション作成画面を整理し、`/sessions/new` は新導線へリダイレクト化

## 2. フェーズごとの実装対応

### Phase 1: IA と主導線の再構築
実装済み。

対象:
- `app/app/dashboard/page.tsx`
- `app/app/students/page.tsx`
- `app/app/students/[studentId]/page.tsx`
- `app/app/students/[studentId]/StudentRecorder.tsx`
- `app/app/students/[studentId]/LessonReportComposer.tsx`

要点:
- `Today` は KPI ではなく今日やることだけを出す画面に変更
- `Students` は urgency 面ではなく、生徒を探して入る画面に変更
- `Student Room` は Hero / 次の会話 / 次回までに確認する行動 / review / 指導報告 / レポート の順に整理
- 面談は録音開始 1アクション中心
- 指導報告は check-in / check-out / 自動生成 の 2-step 導線で統一

### Phase 2: 自動化と progressive results
実装済み。

対象:
- `app/app/students/[studentId]/StudentRecorder.tsx`
- `app/app/students/[studentId]/LessonReportComposer.tsx`
- `app/api/audio/route.ts`
- `app/api/sessions/[id]/parts/route.ts`
- `app/api/students/[id]/room/route.ts`

要点:
- 録音停止後の自動保存と自動生成を前提に変更
- 面談も指導報告も、途中状態を戻って追えるようにした
- Student Room に生成途中の成果物を先出しできる構成に整理
- レポートは生成画面ではなく確認画面として扱う前提を固定

### Phase 3: Proof / Review の統合
実装済み。

対象:
- `app/app/logs/page.tsx`
- `app/app/logs/LogDetailView.tsx`
- `app/app/logs/[logId]/page.tsx`
- `app/app/reports/page.tsx`
- `app/api/sessions/[id]/entities/[entityId]/route.ts`

要点:
- ログ詳細を `要点 / 根拠 / 固有名詞 / 文字起こし` の `Proof Surface` に再構成
- 生徒ルームから根拠確認へ入る導線を前提にした見せ方へ変更
- 固有名詞は Proof Surface 上で候補修正と反映が可能
- Reports に送付待ち以外の review queue を追加
- 授業途中・固有名詞未確認も review queue に乗るよう整理

### Phase 4: デザインシステム化
実装済み。

対象:
- `app/globals.css`
- `app/layout.tsx`
- `components/providers/ThemeProvider.tsx`
- `app/app/settings/page.tsx`
- `components/ui/Card.module.css`
- `components/ui/Button.module.css`
- `components/ui/Badge.module.css`

要点:
- light / dark token を `app/globals.css` に集約
- `ThemeProvider` を追加し、`system / light / dark` を設定画面から切替可能にした
- 初期値は OS の `prefers-color-scheme` 追従
- コンポーネントの面、ボーダー、CTA、余白の原則をトークンベースへ統一
- 設定画面を見た目と運用ポリシーの管理面として再構成

## 3. 主要画面の最終状態

### Today
- 今日の優先行動だけを表示
- 面談開始 / 授業開始の 2起点
- 生徒ごとに CTA は 1個

### Students
- 生徒検索とフィルタに専念
- urgency は Today より弱く表示
- 生徒ルームへの直行を優先

### Student Room
- first viewport に Hero と主 CTA
- 次の会話、次回までに確認する行動、要確認を固定配置
- 生徒理解は 4カテゴリのアコーディオン相当構造で表示
- 指導報告と保護者レポートを同一面に統合

### Reports
- 下書きを作る場所ではなく確認キュー
- 送付待ちレポートのレビューを主導線化
- 送付以外の review item もここに集約

### Proof Surface
- ログ詳細を確認専用の裏面として再設計
- transcript は最後のタブへ後退
- 固有名詞はこの面で修正して反映可能

## 4. テーマと表示ルール

### 実装したテーマ戦略
- 初期値: OS 設定追従
- override: 設定画面で変更
- 保存先: localStorage
- 反映方法: `document.documentElement[data-theme]`

### 状態表現
色だけに頼らず、以下を併用する方針で統一した。

- ラベル文言
- ボーダーと面の差
- バッジ
- CTA の優先度
- 一部の機能色

## 5. 検証結果
以下を実行し、通過を確認した。

- `npm run typecheck`
- `npm run lint`
- `npm run build`

## 6. 補足
今回のテーマ設定は端末ローカル保存であり、サーバー同期はしていない。
これは MVP 段階では妥当で、ユーザー体験に必要な切替はすでに満たしている。

今後さらに詰める場合の優先順は次の通り。

1. モバイルでの safe-area と bottom CTA の最終調整
2. Review Queue の優先順アルゴリズム改善
3. レポートの先行生成を background job 側へ完全移行
