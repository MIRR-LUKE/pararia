# Teacher App の端末管理と紛失時 revoke 導線を管理画面に足す

## 状態

- Closed
- GitHub Issue: `#190`
- 最終更新: `2026-04-25`

## 2026-04-25 に repo へ入ったもの

- settings snapshot に Teacher App device 一覧を追加
- settings UI に端末カードを追加
- 管理者 / 室長だけが理由 + 端末名確認つきで revoke できる API を追加
- revoke helper で device を `REVOKED` にし、active native auth sessions も `REVOKED` に更新
- revoked device は既存 native auth/session checks により次回 refresh / session / recording mutation が通らない
- `test:teacher-app-device-revoke` を追加

## 目的

校舎共通端末を安全に運用するため、管理画面から Teacher App device を見て、紛失・入れ替え時に revoke できるようにする。

## 現状

- native auth は bearer access token + stateful refresh token
- refresh token は server 側に hash 保存され、logout で revoke できる
- `TeacherAppDevice` / `TeacherAppDeviceAuthSession` には last seen / client version 系の情報がある
- ただし、管理者が UI から端末一覧を見たり、紛失端末を無効化する導線はまだ主導線になっていない

## やること

- settings か admin 系画面に Teacher App device 一覧を出す
- device label / status / last seen / client version / active auth session count を表示する
- 管理者が device を revoke / disable できる mutation を用意する
- revoke 後、native app refresh / session / recording mutation が 401 になることを確認する
- 誤操作を避ける確認 UI と audit reason を残す

## 完了条件

- 紛失端末を管理画面から止められる
- 端末入れ替え時に古い refresh session が残らない
- revoke 操作と native auth failure がテストで確認されている
