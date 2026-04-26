# admin dashboard の集計テーブル・インデックス・性能テストを追加する

## 状態

- Done
- GitHub Issue: `#216`
- 作成日: `2026-04-26`

## 目的

何百校舎に増えても `/admin` が重くならないよう、集計・インデックス・ページング・性能確認を入れる。

## 背景

platform admin は横断検索と横断ヘルスを扱うため、素朴に全テーブルを count / join するとすぐ重くなる。初期から性能の逃げ道を作る。

## やること

- 校舎一覧に必要な集計項目を整理する
- 必要な DB index を追加する
- 重い集計は snapshot / materialized summary 相当に分離する
- admin list API に limit / cursor を入れる
- admin dashboard 用の性能テストまたは smoke を追加する
- N+1 query を避ける

## 完了条件

- 何百校舎前提で一覧が破綻しない
- 横断一覧 API がページングされている
- 必要な index が schema に明示されている
- performance smoke で初期表示の劣化を検知できる

## 実装メモ

- `scripts/test-admin-platform-performance.ts` を追加した
- `prisma/schema.prisma` と migration に admin 一覧、ジョブ詰まり検出、校舎詳細集計、監査検索に使う index を追加した
- `npm run test:admin-platform-performance` で以下を静的に検知する
  - `/admin` 初期表示と `/api/admin/platform` が `take/skip` を通す
  - `listAdminCampuses` が `DEFAULT_TAKE = 100` / `MAX_TAKE = 500` で上限を持つ
  - admin snapshot の `findMany` が原則 `take` と明示 `select` を持つ
  - `include`、生テキスト、大きい生成物、raw job error を初期 payload に載せない
  - `Promise.all` / `.map(async` / `forEach(async` による校舎数比例の過剰 fan-out を入れない
  - schema に既存の admin 関連 index が残っている

## 追加した index

- `Organization`: `@@index([updatedAt, createdAt])`
  - `/admin` の校舎一覧 `orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]` 用
- `ConversationJob`: `@@index([status, updatedAt, createdAt])`
  - attention query の `status` + `updatedAt/createdAt` order 用
- `ConversationJob`: `@@index([status, startedAt])`
  - RUNNING stale count / oldest running 用
- `ConversationJob`: `@@index([status, leaseExpiresAt])`
  - lease 切れ RUNNING 検知用
- `SessionPartJob`: `@@index([status, updatedAt, createdAt])`
  - attention query の `status` + `updatedAt/createdAt` order 用
- `SessionPartJob`: `@@index([status, startedAt])`
  - RUNNING stale count / oldest running 用
- `TeacherRecordingJob`: `@@index([organizationId, status, updatedAt, createdAt])`
  - 校舎別 attention / health 用
- `TeacherRecordingJob`: `@@index([organizationId, status, startedAt])`
  - 校舎別 RUNNING stale / oldest running 用
- `TeacherRecordingSession`: `@@index([organizationId, updatedAt])`
  - 校舎一覧の last activity 集計用
- `TeacherRecordingSession`: `@@index([organizationId, recordedAt])`
  - 校舎一覧の recordedAt ベース last activity 集計用
- `StorageDeletionRequest`: `@@index([organizationId, status, updatedAt])`
  - 校舎別 deletion health / stale 検知用
- `StorageDeletionRequest`: `@@index([status, updatedAt, createdAt])`
  - 横断 attention query 用
- `ReportDeliveryEvent`: `@@index([organizationId, eventType, createdAt])`
  - failed / bounced の校舎別 count と attention 用
- `User`: `@@index([organizationId, role])`
  - campus detail の role groupBy 用
- `OrganizationInvitation`: `@@index([organizationId, acceptedAt, expiresAt])`
  - pending / expired invitation count 用
