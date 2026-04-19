# Teacher App の土台を作る: app 分離 / mobile auth / 校舎共通端末登録

## 状態

- Open
- GitHub Issue: `#161`
- 最終更新: `2026-04-19`

## フェーズ

- Phase 1

## 目的

Teacher App を web 管理画面の延長ではなく、校舎共通端末で使う独立した mobile app として立ち上げる。認証、端末登録、画面責務、API 契約の土台を先に固める。

## 何をするか

- Teacher App の app shell を分離する
- mobile auth と token lifecycle を browser session から分離する
- 校舎共通端末としての device registration を入れる
- `1画面1仕事` の state / flow を先に定義する
- provisional UI でも差し替えやすい container / presentation / hook / service 境界を決める
- 管理機能を app に持ち込まないことを path / module で守る

## 完了条件

- 初回だけ管理者がログインして端末登録できる
- 通常利用時は待機画面から始まり、先生にログインを要求しない
- mobile API が actor / device / branch を追える形で定義される
- 画面ロジックが UI 実装から分離され、後から Figma へ差し替えやすい
- Teacher App 側に管理者向け一覧 / 設定 / 詳細導線が混ざらない

## 進捗メモ

- 完了:
  - `/teacher` と `/teacher/setup` を route group で分離した
  - `app/api/teacher/auth/device-login`、`/session`、`/logout` を追加した
  - Teacher App 専用の signed cookie session と session reader を追加した
  - `TeacherAppClient`、screen components、flow hook を分けて provisional UI の差し替え境界を作った
  - 管理者または室長だけが端末設定できる role guard を入れた
- まだ残っていること:
  - device registration の永続化と監査項目の追加
  - mobile bearer lifecycle を含む API 契約の整理
  - provisional flow を実録音 / temporary session / 未送信 queue と接続すること
