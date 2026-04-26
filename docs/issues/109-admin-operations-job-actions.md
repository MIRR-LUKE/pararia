# ジョブ再実行/キャンセルを admin action として移植する

## 状態

- Deferred
- GitHub Issue: `#212`
- 作成日: `2026-04-26`

## 目的

既存のジョブ再実行・キャンセル系操作を、校舎内 settings ではなく platform admin の安全な運営操作として扱う。

## 背景

現状の保守操作は `/admin` に移されたが、思想としてはまだ単一校舎の延長に近い。横断ジョブヘルスと admin action framework の上に載せ替える必要がある。

## 2026-04-26 判断

- 初期 `/admin` は read-only に固定し、再実行・キャンセルは常時露出しない
- write action の監査土台は `PlatformAuditLog` と `lib/admin/platform-audit.ts` で実装済み
- 実行 UI は、非エンジニア向けレビューで対象・影響・理由入力の型が固まってから追加する

## 前提

- `#107` 横断ジョブヘルスが入っている
- `#108` admin action audit framework が入っている

## やること

- 既存の operations job API を platform admin API に寄せる
- 再実行 / キャンセル / 保留解除を admin action として実行する
- 操作前に対象校舎、対象ジョブ、影響範囲を表示する
- 操作理由を必須にする
- 操作結果を `PlatformAuditLog` に記録する
- 一括操作は初回では作らない

## 完了条件

- ジョブ操作が `/app/settings` から分離されている
- 校舎内 `ADMIN` だけでは本番ジョブ操作ができない
- 再実行 / キャンセルが監査つきで行える
- 誤操作を避ける確認 UI がある
