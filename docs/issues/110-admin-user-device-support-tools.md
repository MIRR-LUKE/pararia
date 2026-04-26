# ユーザー/Teacher App 端末の支援操作を admin に集約する

## 状態

- Deferred
- GitHub Issue: `#213`
- 作成日: `2026-04-26`

## 目的

校舎ユーザーと Teacher App 端末の支援操作を、PARARIA 運営側が校舎詳細から安全に確認・対応できるようにする。

## 背景

端末 revoke は校舎 settings 側に実装済みだが、何百校舎を運営が支援するには platform admin 側にも集約された導線が必要。

## 2026-04-26 判断

- 初期 `/admin` は read-only にし、校舎詳細でユーザー数、ロール分布、端末数を確認できるようにした
- 端末 revoke、ユーザー停止、代理閲覧は危険操作として初期 UI から外した
- 追加する場合は対象校舎、対象端末/ユーザー、理由、戻せるか、監査記録を必須にする

## やること

- 校舎詳細にユーザー一覧の概況を出す
- 招待中 / 停止中 / 最終ログイン / ロール分布を表示する
- Teacher App 端末一覧を校舎詳細に出す
- device label / status / last seen / active auth session count を表示する
- revoke は admin action framework が入るまで read-only にする
- revoke を入れる場合は理由入力と監査を必須にする

## 完了条件

- 運営者が校舎のユーザー/端末状態を把握できる
- 紛失端末対応の入口が platform admin 側にある
- 危険操作は監査フレームワークなしで露出しない
- 校舎側 settings と運営側 admin の役割が admin spec / README / runbook / security matrix で説明されている
