# PlatformOperator / PlatformRole / PlatformAuditLog を追加する

## 状態

- Done
- GitHub Issue: `#205`
- 作成日: `2026-04-26`

## 目的

校舎内の `ADMIN` と、PARARIA 運営者の権限を完全に分ける。`/admin` は校舎ユーザーの延長ではなく、運営側バックオフィスとして扱う。

## 背景

現状の `UserRole` は `ADMIN`, `MANAGER`, `TEACHER`, `INSTRUCTOR` で、すべて `organizationId` に紐づく校舎内ロールになっている。このままでは、何百校舎を横断する運営コンソールを安全に作れない。

## やること

- `PlatformOperator` を追加する
- `PlatformRole` を追加する
- `PlatformAuditLog` を追加する
- 運営者判定 helper を追加する
- 既存の `PARARIA_ADMIN_OPERATOR_EMAILS` allowlist は移行用として残し、DB ロールを正にする
- admin write 操作の監査に必要な actor / target / reason / before / after / request metadata を保存できる形にする

## 完了条件

- 校舎内 `ADMIN` だけでは platform admin 権限を得られない
- platform operator は DB で明示的に管理できる
- admin write action の監査先が用意されている
- 型チェックと権限 helper の focused test が通る
