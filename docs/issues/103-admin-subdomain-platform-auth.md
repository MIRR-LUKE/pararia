# admin サブドメインと platform admin 認証を分離する

## 状態

- Done
- GitHub Issue: `#206`
- 作成日: `2026-04-26`

## 目的

本番の `/admin` を通常アプリ導線から分け、`admin.pararia...` のような管理者サブドメインを正式入口にできるようにする。

## 背景

管理者コンソールは、クライアント校舎の設定画面とは認証・権限・監査の性質が違う。通常ホストの `/admin` に置くだけでは、運営者向けバックオフィスとしての境界が弱い。

## やること

- admin host 判定を platform admin 用に整理する
- 通常ホストの `/admin` は admin base URL へリダイレクトできるようにする
- admin host の `/` は `/admin` へ寄せる
- admin route は `PlatformOperator` を必須にする
- 校舎内 session だけで admin API に入れないことを確認する
- docs 側の環境変数説明を更新する。README は今回の担当範囲外のため後続で更新する

## 完了条件

- 本番で admin サブドメインを正式入口にできる
- 通常アプリと admin の入口が明確に分離される
- 校舎内 `ADMIN` のみのユーザーは `/admin` に入れない
- route guard の focused test が通る
