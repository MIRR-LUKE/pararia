# マルチテナント分離監査

最終更新: 2026-04-25

## 目的

本書は、Pararia SaaS の組織境界が API、サービス層、DB 整合性の各層で維持されていることを説明し、継続的に検査するための設計と現状チェックをまとめる。

前提として、現行実装は DB Row Level Security ではなく、アプリケーション層で `organizationId` を必ず検索条件・作成値・更新対象確認へ含める方式を主統制としている。

## テナント境界モデル

| 資産 | 境界キー | 主な参照 route/service | 境界方針 |
| --- | --- | --- | --- |
| User | `organizationId` | `auth.ts`, `resolveAuthorizedSession` | セッションの userId を入口に、DB の最新 User から所属組織とroleを補正する |
| Student | `organizationId` | `/api/students`, `/api/students/[id]`, Teacher App students | 所属組織かつ `archivedAt: null` のみ通常表示 |
| Session | `organizationId`, `studentId` | `/api/sessions`, session progress, Teacher App promotion | セッション作成時に生徒の所属組織を照合 |
| SessionPart | `sessionId` | session parts routes | 親 Session の組織境界を経由して照合 |
| ConversationLog | `organizationId`, `studentId`, `sessionId` | `/api/conversations/[id]`, logs pages | 所属組織かつ `deletedAt: null` のみ通常表示 |
| ConversationJob | `conversationId` | conversation job workers | 親 ConversationLog の境界に従う |
| Report | `organizationId`, `studentId` | `/api/reports/[id]`, report dashboard | 所属組織かつ `deletedAt: null` のみ通常表示 |
| ReportDeliveryEvent | `organizationId`, `studentId`, `reportId` | report delivery services | Report/Student と同一組織であることを DB 検査対象にする |
| TeacherAppDevice | `organizationId` | Teacher App device auth | 端末 ID、組織、ACTIVE 状態を同時に照合 |
| TeacherAppDeviceAuthSession | `organizationId`, `deviceId`, `userId` | native Teacher App auth | refresh/access session は組織、端末、ユーザーを照合 |
| TeacherRecordingSession | `organizationId`, `deviceId`, `selectedStudentId` | Teacher App recordings | 組織と端末 scope で読み書きし、確定時に生徒組織を再確認 |
| ProperNounGlossaryEntry/Suggestion | `organizationId`, `studentId` | transcript/glossary flows | 組織と生徒の整合性を DB 検査対象にする |
| AuditLog | `organizationId`, `userId` | `writeAuditLog` | 操作主体・対象の追跡。境界統制ではなく証跡統制 |

## 現状チェック

### 実装済み

- すべての通常アプリ API は `requireAuthorizedSession` または `requireAuthorizedMutationSession` を入口にする設計である。
- セッションに古い `organizationId` や role が含まれていても、`resolveAuthorizedSession` が DB の最新 User 情報を正として補正する。所属変更・ロール変更・退職ユーザー削除は、次回の認可判定に反映される。
- 変更系 API は `requireAuthorizedMutationSession` により同一生成元チェックを通過したセッションのみ許可する。
- 生徒・ログ・レポートの主要 route はセッション由来の `organizationId` を Prisma の `where` 条件へ含める。
- 生徒一覧は `listStudentRows({ organizationId })` と `withActiveStudentWhere` により、他組織およびアーカイブ済み生徒を除外する。
- 会話とレポートは `withVisibleConversationWhere` / `withVisibleReportWhere` により論理削除済みを通常表示から除外する。
- 設定変更、招待、Teacher App 端末設定はロールチェックを通過したユーザーに限定される。
- Teacher App の Cookie session は `loadActiveTeacherAppDevice({ deviceId, organizationId })`、Bearer session は `loadActiveTeacherAppNativeAuthContext({ authSessionId, organizationId })` で ACTIVE 状態と組織を照合する。
- Teacher App 録音確定時は `selectedStudentId` が同一 `organizationId` かつ `archivedAt: null` であることを確認してから Session へ昇格する。
- 保守 route は `requireMaintenanceAccess` により管理者セッションまたは保守鍵に限定される。

### 継続監査対象

- 新規 API route が追加された時、変更系 route に `requireAuthorizedMutationSession` と `applyLightMutationThrottle` があるか。
- ID 指定 route が `id` のみで `findUnique` していないか。読み取り前に `organizationId` を含む `findFirst` または親スコープ照合があるか。
- Worker/maintenance 処理がユーザーセッションを持たない場合、対象 ID の親データから組織境界を復元しているか。
- Relation include で親の組織条件に依存している箇所は、親検索の `organizationId` 条件が抜けると漏えいにつながるため重点レビューする。
- DB 内の親子行が異なる `organizationId` を持つ不整合は、アプリ層の route 条件だけでは検出できないため、読み取り専用 SQL で定期検査する。

## 組織境界テスト設計

### 1. 静的検査

目的: DB 接続なしで、危険な route 実装パターンを早期に検出する。

検査内容:

- 主要 route/service ファイルが存在すること。
- 変更系 route が `requireAuthorizedMutationSession` を使うこと。
- 変更系 route が `applyLightMutationThrottle` を使うこと。
- ID 指定 route が `organizationId` を検索条件へ含めること。
- Teacher App session が組織、端末、ACTIVE 状態を照合すること。
- 共通 visibility helper が `deletedAt: null` を付与すること。

実行:

```bash
npx tsx scripts/test-tenant-isolation-boundaries.ts
```

### 2. DB 読み取り専用検査

目的: seed または実データ上で、親子テーブルの `organizationId` が矛盾していないことを検証する。

実行条件:

- `DATABASE_URL` が設定されている場合に実行する。
- `DIRECT_URL` のみを使う場合は既存の DB URL 方針に従い、`PARARIA_USE_DIRECT_DATABASE_URL=1` を明示する。
- 接続情報がない場合は DB 検査を skip し、静的検査のみ pass/fail する。

検査対象:

- User -> Organization
- Student -> Organization
- Session -> Organization/Student/User
- SessionPart -> Session
- ConversationLog -> Organization/Student/User/Session
- ConversationJob -> ConversationLog
- Report -> Organization/Student/User
- ReportDeliveryEvent -> Report/Organization/Student/User
- StudentRecordingLock -> Organization/Student/User
- TeacherAppDevice -> Organization/User
- TeacherAppDeviceAuthSession -> Organization/Device/User
- TeacherRecordingSession -> Organization/User/Device/selectedStudent
- TeacherRecordingJob -> TeacherRecordingSession/Organization
- ProperNounGlossaryEntry -> Organization/Student/User
- ProperNounSuggestion -> Organization/Student/Session/SessionPart/Conversation/GlossaryEntry
- NextMeetingMemo -> Organization/Student/Session/Conversation

### 3. Route 境界テスト

将来の fixture 設計:

- orgA と orgB を作成する。
- orgA user で orgB student/report/conversation ID を指定し、GET/PUT/DELETE が 404 または 403 になることを確認する。
- orgA user が orgA data を正常に取得できる positive case も併置する。
- fixture はローカル・CI 専用 DB に限定し、本番 DB では絶対に作成しない。

現時点では、本リポジトリの追加スクリプトは fixture 作成を行わない。安全性を優先し、静的検査と既存データの読み取り専用整合性検査に留める。

## 監査チェックリスト

| チェック | 判定基準 | 現状 |
| --- | --- | --- |
| API 認証 | 業務 API が `requireAuthorizedSession` 系を通る | 実装済み |
| 変更系 CSRF | Cookie mutation が same-origin を確認する | 実装済み |
| 変更系 throttle | write 系が user/org/ip 単位の throttle を通る | 実装済み |
| ID 指定読み取り | `organizationId` を含む `findFirst` または親 scope 確認を使う | 主要 route 実装済み |
| 論理削除除外 | 通常表示で `deletedAt: null` を使う | 実装済み |
| アーカイブ除外 | 通常表示で `archivedAt: null` を使う | 実装済み |
| Teacher App 端末境界 | deviceId + organizationId + ACTIVE を照合する | 実装済み |
| DB 不整合 | 親子 `organizationId` の矛盾が 0 件 | 追加スクリプトで検査 |
| 保守 route | 管理者または保守鍵のみ実行可能 | 実装済み |
| 監査証跡 | 重要変更が AuditLog に残る | 主要操作実装済み |

## 審査提出時の説明文

Pararia SaaS は、認証セッションの userId を入口に DB の最新 User 情報を取得し、すべての主要業務データ検索に `organizationId` を含めています。生徒、面談ログ、レポート、Teacher App 端末、録音セッションなどの主要テーブルは組織 ID を持ち、ID 指定 API でも組織条件を同時に指定することで他組織データを 404 として扱います。変更系 API は認証、同一生成元チェック、レート制限、監査ログを組み合わせて保護しています。

DB レベルの Row Level Security は現時点の主統制ではありません。そのため、リリース前に `scripts/test-tenant-isolation-boundaries.ts` を実行し、静的検査と読み取り専用の DB 整合性検査で境界不備を継続確認します。
