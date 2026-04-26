# SaaSセキュリティ統制表

最終更新: 2026-04-25

## 目的と前提

本書は、Pararia SaaS を上場企業の情報システム・セキュリティ審査へ提出できる粒度で説明するためのセキュリティ統制表である。対象は現行リポジトリの Web アプリ、API route、Teacher App、DB 境界、保守 route、platform admin、監査ログ、レート制限、セキュリティヘッダーである。

本書はコードレビュー時点の実装証跡に基づく。運用証跡、インフラ設定、外部サービスの管理画面証跡は別途提出が必要である。

## 統制サマリ

| 領域 | 統制目的 | 現状 | 実装証跡 | 審査時の提出物 |
| --- | --- | --- | --- | --- |
| 認証 | 未認証ユーザーの業務 API 利用を防ぐ | 実装済み | `auth.ts`, `lib/auth.ts`, `lib/server/request-auth.ts` | 認証方式説明、セッション設定、ログイン失敗時の挙動 |
| パスワード保護 | 保存済みパスワードを平文化させない | 実装済み | `lib/auth.ts` の bcrypt hash/compare | パスワード保存方式、リセット手順 |
| セッション属性 | セッションの userId を入口にし、DB の最新 user/role/organizationId を正として扱う | 実装済み | `auth.ts`, `resolveAuthorizedSession` | JWT/Session 設計、退職者・所属変更時の無効化運用 |
| 認可 | 管理系操作をロールで制限する | 実装済み | `lib/permissions.ts`, `app/api/settings/route.ts`, `app/api/invitations/route.ts` | ロール一覧、権限表 |
| テナント分離 | 組織外データ参照・更新を防ぐ | 実装済み、一部継続監査 | `organizationId` を含む route 検索条件、`docs/tenant-isolation-audit.md` | 境界テスト結果、DB 整合性確認 |
| CSRF/同一生成元 | Cookie ベースの変更系 API を外部サイトから実行させない | 実装済み | `requireAuthorizedMutationSession`, `requireSameOriginRequest` | CSRF 方針、例外 route 一覧 |
| 保守 route 保護 | ジョブ・メンテナンス API を一般ユーザーから隔離する | 実装済み | `requireMaintenanceAccess`, `isMaintenanceRoutePath` | 保守鍵管理手順、実行者一覧 |
| レート制限 | ログイン試行、書き込み、重い処理、アップロード集中を抑制する | 実装済み | `lib/auth-throttle.ts`, `lib/api-throttle.ts`, `lib/server/request-throttle.ts` | しきい値表、429 発生時の案内 |
| 監査ログ | 重要操作の追跡性を確保する | 実装済み、一部 route の網羅確認継続 | `lib/audit.ts`, student/report/settings/device routes | AuditLog 抽出サンプル、保管期間 |
| セキュリティヘッダー | ブラウザ側の攻撃面を抑制する | 実装済み | `config/csp.mjs`, `next.config.mjs` | ヘッダー一覧、CSP report-only 切替方針 |
| 招待制 | 公開サインアップを避け、管理者発行招待に限定する | 実装済み | `OrganizationInvitation`, `app/api/invitations/route.ts` | 招待発行・失効手順 |
| Teacher App 端末認証 | 教師アプリ端末を組織・端末単位で認証、失効する | 実装済み | `lib/server/teacher-app-session.ts`, `lib/teacher-app/device-registry.ts` | 端末登録・失効台帳 |
| 論理削除・復元 | 削除済みデータの表示漏れと復元権限を制御する | 実装済み | `withVisibleConversationWhere`, `withVisibleReportWhere`, `student-lifecycle.ts` | 削除・復元手順、監査ログ |
| 入力検証 | 不正 JSON と型不一致を受け付けない | 部分実装 | `parseJsonWithSchema`, 各 route の normalize 処理 | route 別バリデーション一覧 |
| データ保持 | 生文字起こし・削除要求・バックアップを運用で管理する | 部分実装 | `rawTextExpiresAt`, `transcriptExpiresAt`, `docs/data-retention-policy.md` | 保持期間、削除 SLA、バックアップ証跡 |

## 参照基準と対応範囲

本書は、次の外部基準を「審査時の説明軸」として使う。認証取得を宣言するものではなく、現行コードと運用証跡がどの統制要求を満たすかを説明できる状態にする。

| 基準 | 本書で見る領域 | 主な証跡 |
| --- | --- | --- |
| OWASP ASVS | 認証、セッション、アクセス制御、入力検証、監査ログ、ヘッダー | `AUTH-*`, `RBAC-*`, `TENANT-*`, `MUT-*`, `AUDIT-*`, `WEB-*` |
| OWASP API Security Top 10 2023 | object level authorization、broken authentication、unrestricted resource consumption、security misconfiguration | `TENANT-*`, `RBAC-*`, `MUT-*`, `WEB-*`, `API_THROTTLE_RULES` |
| NIST SSDF | secure development、review、secret scan、release gate、rollback、証跡 | `scan:secrets`, `check:code-shape`, `test:migration-safety`, `docs/release-governance.md` |

実装回帰は `npm run test:security-headers`、`npm run test:tenant-isolation-boundaries`、`npm run test:maintenance-route-guards`、`npm run scan:secrets`、`npm run check:code-shape` を最低 gate とする。エンタープライズ基盤全体の証跡連結は `docs/enterprise-readiness-evidence.md` と `npm run test:enterprise-readiness-evidence` で検査する。

## 詳細統制

### 1. 認証・セッション管理

| 統制ID | 統制内容 | 現状 | 実装証跡 | 残リスク・運用補足 |
| --- | --- | --- | --- | --- |
| AUTH-01 | 業務アプリは NextAuth Credentials により認証する | 実装済み | `auth.ts` | SSO 要件がある顧客には IdP 連携方針を別途提示する |
| AUTH-02 | パスワードは bcrypt でハッシュ化して保存する | 実装済み | `hashPassword`, `verifyPassword` | パスワードポリシー、リセットフローは運用・UI 側の提示が必要 |
| AUTH-03 | セッションには userId/role/organizationId を含める | 実装済み | `jwt` / `session` callbacks | JWT 失効の即時性は Cookie/JWT 有効期限設定に依存 |
| AUTH-04 | セッション上の組織 ID / role をそのまま信じず、DB の最新 User 情報で補正する | 実装済み | `resolveAuthorizedSession` | ユーザー削除時は認証失敗として扱う。大規模化時はDB負荷を監視する |
| AUTH-05 | ログイン失敗をメール単位・IP 単位で抑制する | 実装済み | `AuthThrottle`, `assertAuthThrottleAllowed`, `recordAuthThrottleFailure` | 監視通知の有無は別途確認 |

### 2. 認可・ロール管理

| 統制ID | 統制内容 | 現状 | 実装証跡 | 残リスク・運用補足 |
| --- | --- | --- | --- | --- |
| RBAC-01 | 管理者・室長・講師のロールを定義する | 実装済み | `UserRole`, `lib/permissions.ts` | 顧客別カスタムロールは未実装 |
| RBAC-02 | 設定変更は管理者または室長に限定する | 実装済み | `canManageSettings`, `app/api/settings/route.ts` | 設定変更は AuditLog へ記録される |
| RBAC-03 | 招待作成・一覧は管理者または室長に限定する | 実装済み | `canManageInvitations`, `app/api/invitations/route.ts` | 室長は管理者・室長の招待を作成できない |
| RBAC-04 | 保守 route は管理者セッションまたは保守鍵に限定する | 実装済み | `requireMaintenanceAccess`, `isMaintenanceRoutePath`, `proxy.ts` | 保守鍵の保管・ローテーション証跡が必要。保守鍵実行は userId が残らないため、鍵の保有者・実行者台帳で補完する |
| RBAC-06 | `/admin` と `app/api/admin/**` は校舎内ロールから分離し、platform operator のみに限定する | 実装済み | `app/admin/page.tsx`, `app/api/admin/platform/route.ts`, `app/api/admin/campuses/[organizationId]/route.ts`, `PlatformOperator`, `PlatformRole`, `PlatformAuditLog`, `PARARIA_ADMIN_HOSTS`, `PARARIA_ADMIN_BASE_URL` | 本番は admin サブドメインを正式入口にする。`PARARIA_ADMIN_OPERATOR_EMAILS` は移行・緊急用 allowlist に限定し、DB ロールを正とする。校舎内 `ADMIN` だけで入れないことを regression test に含める |
| RBAC-05 | Teacher App 端末設定は管理者または室長に限定する | 実装済み | `canConfigureTeacherAppDevice` | 端末登録時の本人確認運用を提出する |

### 3. マルチテナント分離

| 統制ID | 統制内容 | 現状 | 実装証跡 | 残リスク・運用補足 |
| --- | --- | --- | --- | --- |
| TENANT-01 | 主要テーブルに `organizationId` を保持する | 実装済み | Prisma schema の User/Student/Session/ConversationLog/Report など | DB レベル RLS は未確認。アプリケーション層分離が主 |
| TENANT-02 | API は認証済みセッションの `organizationId` を検索条件へ含める | 実装済み | student/conversation/report/settings routes | 新規 route 追加時の静的検査が必要 |
| TENANT-03 | 生徒一覧は所属組織と未アーカイブ条件に限定する | 実装済み | `listStudentRows`, `withActiveStudentWhere` | include 先の relation も親スコープに依存 |
| TENANT-04 | ログ・レポートは論理削除済みを通常表示から除外する | 実装済み | `withVisibleConversationWhere`, `withVisibleReportWhere`, `/admin` | 運営側復元画面は管理者ロールと組織スコープで制限する |
| TENANT-05 | Teacher App は端末・組織・状態 ACTIVE を照合する | 実装済み | `loadActiveTeacherAppDevice`, `loadActiveTeacherAppNativeAuthContext` | Bearer token 漏えい時の失効手順が必要 |
| TENANT-06 | DB 上の親子テーブルが異なる `organizationId` を持たないか確認する | 検査追加 | `scripts/test-tenant-isolation-boundaries.ts` | 本番前とリリース前に読み取り専用で実行 |

### 4. 変更系 API 保護

| 統制ID | 統制内容 | 現状 | 実装証跡 | 残リスク・運用補足 |
| --- | --- | --- | --- | --- |
| MUT-01 | 変更系 API は認証必須とする | 実装済み | `requireAuthorizedMutationSession` | 新規 route のレビュー項目に含める |
| MUT-02 | Cookie セッションを使う変更系 API は Origin/Referer/Sec-Fetch-Site を検査する | 実装済み | `requireSameOriginRequest` | サーバー間 request はブラウザヘッダーなしのため許可 |
| MUT-03 | 変更系 API はユーザー・組織・IP 単位の軽量 throttle を適用する | 実装済み | `applyLightMutationThrottle` | heartbeat/progress 系は UX のため bypass |
| MUT-04 | 重い生成・アップロードは専用 quota を使う | 実装済み | `API_THROTTLE_RULES.reportGenerate*`, `blobUpload*`, `sessionPart*` | しきい値は運用負荷に応じて見直す |

### 5. 監査ログ

| 統制ID | 統制内容 | 現状 | 実装証跡 | 残リスク・運用補足 |
| --- | --- | --- | --- | --- |
| AUDIT-01 | 監査ログには組織、ユーザー、操作、対象、状態、詳細を保存する | 実装済み | `AuditLog`, `writeAuditLog` | detailJson に機微情報を入れない運用が必要 |
| AUDIT-02 | 生徒作成・更新・アーカイブを監査記録する | 実装済み | `app/api/students/*` | 監査失敗時は warning を返す実装あり |
| AUDIT-03 | レポート削除・送信・復元を監査記録する | 実装済み | `app/api/reports/*` | 配信イベントとの突合が可能 |
| AUDIT-04 | 設定変更を監査記録する | 実装済み | `app/api/settings/route.ts` | 設定差分の詳細化は改善余地 |
| AUDIT-05 | 保守ジョブ・cleanup を監査記録する | 実装済み | `app/api/jobs/run/route.ts`, `app/api/maintenance/cleanup/route.ts` | 保守鍵実行時は userId が null |
| AUDIT-06 | 監査ログの抽出・保管期間を定義する | 運用要件 | `AuditLog` model | SIEM 連携や定期エクスポートは別途整備 |
| AUDIT-07 | platform admin の write 操作は理由、対象、影響範囲、変更前後、request metadata を `PlatformAuditLog` に記録する | 土台実装済み | `lib/admin/platform-audit.ts`, `PlatformAuditLog`, `docs/issues/108-admin-action-audit-framework.md` | 初期 `/admin` は read-only。ジョブ再実行、端末 revoke、ユーザー停止、PII 表示、export を追加する場合は監査なしで実行不可にする。理由入力のない write API はレビューで差し戻す |

### 6. ブラウザ・ネットワーク保護

| 統制ID | 統制内容 | 現状 | 実装証跡 | 残リスク・運用補足 |
| --- | --- | --- | --- | --- |
| WEB-01 | CSP を本番では enforcement として適用する | 実装済み | `buildSecurityHeaders` | `PARARIA_CSP_REPORT_ONLY=1` は rollback 用 |
| WEB-02 | `X-Content-Type-Options: nosniff` を適用する | 実装済み | `config/csp.mjs` | なし |
| WEB-03 | `Referrer-Policy: strict-origin-when-cross-origin` を適用する | 実装済み | `config/csp.mjs` | なし |
| WEB-04 | `Permissions-Policy` で camera/geolocation 等を閉じる | 実装済み | `config/csp.mjs` | microphone は録音機能のため self 許可 |
| WEB-05 | 本番で HSTS を適用する | 実装済み | `config/csp.mjs` | プロキシ/CDN 側 TLS 設定証跡が必要 |

### 7. データ保護・削除

| 統制ID | 統制内容 | 現状 | 実装証跡 | 残リスク・運用補足 |
| --- | --- | --- | --- | --- |
| DATA-01 | 生徒は論理アーカイブし、通常一覧から除外する | 実装済み | `archiveStudent`, `withActiveStudentWhere` | 完全削除の運用 SLA は別途定義 |
| DATA-02 | アーカイブ時に関連データ snapshot を作成する | 実装済み | `StudentArchiveSnapshot` | snapshot の保持期間を運用で定義 |
| DATA-03 | 会話・レポートは論理削除し通常表示から除外する | 実装済み | `deletedAt`, visibility helpers | 法的削除要件がある場合は物理削除手順が必要 |
| DATA-04 | 音声・文字起こしは TTL フィールドを持つ | 部分実装 | `rawTextExpiresAt`, `transcriptExpiresAt` | 実削除ジョブと証跡の定期確認が必要 |
| DATA-05 | Blob 削除要求をキュー化する | 実装済み | `StorageDeletionRequest` | 外部 Blob 側の削除完了証跡が必要 |

## 審査で説明すべき制約

- 現状のテナント分離はアプリケーション層の `organizationId` 条件を主統制としている。DB Row Level Security の有無は本書の対象外であり、必要な顧客には追加設計が必要である。
- 現行 `resolveAuthorizedSession` はセッションの userId を入口に DB の最新 User 情報を取得し、組織 ID / role / 氏名 / メールを補正する。所属変更・ロール変更・退職の反映はアプリケーション層では担保されるが、監査上は変更操作の証跡と退職者棚卸しも併せて提出する。
- 監査ログは重要操作へ実装済みだが、全 route の操作網羅性は継続監査対象である。
- CSP は本番で enforce されるが、開発環境および rollback flag では report-only となる。
- 保守鍵実行は userId が残らないため、鍵の保有者・実行者台帳を運用で管理する必要がある。
- platform admin はクライアント校舎の `/app/settings` と別の運営側バックオフィスである。`/app/settings` に横断保守、ジョブ復旧、PII 代理閲覧、監査 export を置かない。
- platform admin 初期表示では PII、面談本文、音声、内部 error code を出さない。必要時は理由入力と `PlatformAuditLog` を通す。
- 外部サービス、Vercel/Supabase/Blob/Runpod/OpenAI の管理画面設定とアクセス権限は別紙の運用証跡で補完する。

## 推奨する定期確認

| 頻度 | 確認項目 | コマンド・証跡 |
| --- | --- | --- |
| リリース前 | セキュリティヘッダー regression | `npm run test:security-headers` |
| リリース前 | 認証 throttle regression | `npm run test:auth-throttle` |
| リリース前 | 保守 route guard regression | `npm run test:maintenance-route-guards` |
| リリース前 | テナント境界の静的・DB 読み取り検査 | `npx tsx scripts/test-tenant-isolation-boundaries.ts` |
| リリース前 | platform admin UX / 権限境界の静的補助チェック | `npx tsx scripts/check-admin-console-simplification.ts` |
| 月次 | AuditLog 抽出と重要操作の突合 | DB 読み取りクエリまたは管理者用抽出 |
| 月次 | 退職者・端末・保守鍵・platform operator の棚卸し | ユーザー台帳、Teacher App device、環境変数台帳、PlatformOperator 台帳 |
