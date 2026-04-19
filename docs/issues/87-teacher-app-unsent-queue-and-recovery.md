# Teacher App の未送信キューと復旧導線を作る: 再送 / 二重送信防止 / 再起動耐性

## 状態

- Open
- GitHub Issue: `#163`
- 最終更新: `2026-04-19`

## フェーズ

- Phase 2

## 目的

失敗ケースを main flow の外に逃がさず、未送信一覧と再送で必ず戻せるようにする。通信断、upload failure、二重送信、アプリ再起動に強い Teacher App にする。

## 何をするか

- app 端末内キューを持ち、未送信音声と状態を保持する
- 未送信一覧画面と `再送 / 削除` 導線を作る
- 二重送信防止と idempotency key を API 契約に入れる
- app 再起動後も pending / failed item を復元する
- 失敗時の UX 文言を最小限にそろえる
- 最低限の telemetry / error context を残し、web 側運用で追えるようにする

## 完了条件

- upload failure 後に未送信一覧から再送できる
- 通信断や app 再起動後も未送信が消えない
- 同じ録音を二重に送っても session / conversation が壊れない
- 先生向け app では詳細エラーを見せすぎず、やることが `再送` に絞られている
- 管理 web 側で必要最低限の監査情報を追える

## 進捗メモ

- いまは未送信一覧の画面枠だけあり、`items` はまだ空で `unsentCount` も仮値のまま
- 端末内 queue、再送、再起動後復元、idempotency はまだ未接続
- temporary recording flow の main path を先に通し、その後に recovery をここへ寄せる
