# Pararia UI Renewal Plan

## 目的

Pararia のWeb UIを、Figma `Pararia UI Renewal Foundation` に合わせて、上場企業の情シス・教室責任者・運用担当が迷わず使える品質へ更新する。

## Figma Foundation

- Figma: https://www.figma.com/design/5TxgT9vY1UhxzE1stn60ol
- Design issue: #219
- Implementation epic: #221
- 方針: モノクロ中心、白基調、アクセントは状態・警告・録音・フォーカスに限定
- 言語: 日本語を基本表示、英字ブランド/短い英語ラベルのみ `Open Sans`
- Webの責務: ログ確認、文字起こしレビュー、次回面談提案、分析、保護者レポート、設定、運用
- Androidの責務: 録音、アップロード、生徒確認、未送信キュー、診断
- Web録音導線は持たない

## Dependency Decision

現時点では新規UIライブラリは追加しない。

- CSS Modules を継続する
- `clsx` は既存利用を継続する
- `lucide-react` はアイコン量が増える画面刷新時に再判断する
- Radix / `cmdk` / TanStack Table は、操作量とアクセシビリティ要件が明確になった画面で限定導入する
- Tailwind移行は行わない

理由:

- 現在の課題は色・余白・状態・操作導線の統一であり、依存追加よりトークンと既存プリミティブの整備が先
- 不要な依存を増やさず、監査・保守・ビルドの見通しを保つ
- Figma Foundationの表現は既存のCSS Modulesで再現できる

## Foundation Completion Criteria

- `app/globals.css` はライトテーマをデフォルトにする
- `[data-theme="dark"]` でダークテーマ変数を持つ
- 旧紫ブランドと蛍光ライムの主要アクションを廃止する
- `--brand` / `--accent` / `--surface-*` は互換を維持しつつモノクロへマップする
- Button / Badge / Card / Dialog / Tabs / StatePanel / Loading / Progress がライト・ダークで破綻しない
- フォーカス、disabled、loading、danger、compact相当の状態を共有コンポーネント側で扱う
- ルート側のデータ取得、認証、テナント、生成パイプラインは変更しない

## Route Issue Order

1. #236 Dependency decision and UI library installation plan
2. #222 Tokens, CSS variables, and light/dark theme foundation
3. #223 Rebuild primitive components for release UI
4. #224 App shell, sidebar, top bar, and command search
5. #225 Auth and login release UI
6. #226 Dashboard priority queue release UI
7. #227 Student Directory release UI
8. #228 Logs inbox and transcript review release UI
9. #229 Student Room release UI
10. #230 Reports release UI and send-safety workflow
11. #231 Settings release UI and safe admin operations
12. #232 Operations release UI for jobs, workers, failures, and audit logs
13. #233 Android teacher app recording-only visual polish
14. #234 Cross-cutting loading, empty, error, permission, dirty, and disabled states
15. #235 Accessibility, keyboard, responsive, and visual QA gate

## UI QA Gate

Foundation以降の各Issueは、最低限次を確認してからcloseする。

- `npm run test:ui-renewal-foundation`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- 対象画面の既存route smoke testがある場合は追加で実行する

最終QAでは `npm run verify` と、ログ、Student Room、Reports、Settings、Admin、Android録音フローの重要導線を確認する。
