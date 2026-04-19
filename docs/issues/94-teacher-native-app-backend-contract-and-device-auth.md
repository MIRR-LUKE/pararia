# Teacher native app 用の backend 契約と device auth を固める

## 状態

- Open
- GitHub Issue: `#172`
- 最終更新: `2026-04-19`

## 目的

iOS / Android の native app を別実装にしても、backend 側の責務をぶらさない。  
Teacher native app が叩く API、device auth、idempotency、actor audit をここで固定する。

## 親 issue

- `#171` / `93` Teacher 録音 app を完全ネイティブ前提で作り直す全体計画

## この issue でやること

- native app が使う auth model を決める
- 校舎共通端末の device registration / revoke / rotate を backend 契約に落とす
- temporary recording session 作成から student confirm までの API 契約を明文化する
- upload idempotency と duplicate submit guard を native app 前提で整理する
- `deviceId`, `platform`, `appVersion`, `buildNumber` などの observability fields を定義する
- admin web 側で native app の失敗を追える minimum audit を決める

## ここで決めるべきこと

- signed cookie をやめて bearer token に寄せるのか
- token refresh を native app 側でどう扱うのか
- audio upload を direct upload にするのか app 経由 upload にするのか
- student confirm 後の promote job をどの API で確定させるのか

## 完了条件

- native app 実装者が backend 契約を見て迷わない
- device auth の revoke / rotate / audit が明文化される
- duplicate upload と duplicate confirm の防止策が backend 契約に入る
- iOS / Android 実装が同じ API 正本を共有できる
