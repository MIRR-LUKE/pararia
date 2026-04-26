# docs / security matrix / runbook を platform admin 仕様へ更新する

## 状態

- Done
- GitHub Issue: `#217`
- 作成日: `2026-04-26`

## 目的

`/admin` と `/app/settings` の役割、admin サブドメイン、運営者権限、監査、危険操作の運用を docs に反映する。

## 背景

一度 `/settings` に保守UXを置きかけた経緯があるため、今後の実装者が同じ間違いをしないよう、仕様、セキュリティ文書、runbook に境界を明記する必要がある。README は今回の担当範囲外のため触らず、後続更新として残す。

## やること

- `docs/admin-console-platform-spec.md` に `/app/settings` と `/admin` の責務境界を明記する
- `docs/security-control-matrix.md` を platform admin 前提に更新する
- `docs/production-slo-runbooks.md` へ admin console の運用手順を追加する
- `docs/admin-console-review-checklist.md` への導線を追加する
- admin サブドメインの環境変数と本番運用を説明する
- 校舎側 settings に運営保守操作を置かない方針を明記する

## 完了条件

- `/app/settings` はクライアント校舎向け設定として docs 内で説明されている
- `/admin` は PARARIA 運営側バックオフィスとして docs 内で説明されている
- admin 権限と監査の運用が security matrix に反映されている
- 新しい実装者が仕様の境界を読み取れる
