# 主経路の失敗を stage / operationId 付きで可視化する

## 状態

- Open
- GitHub Issue: `#82`
- 最終更新: `2026-04-14`

## 何をするか

student room、recording lock、next meeting memo などの主経路で、失敗を `stage` と `operationId` 付きの形に揃える。

## なぜやるか

今は `処理に失敗しました` に近い見え方が多く、どの段階で壊れたのかが取りにくい。

そのため、

- lock 失敗なのか
- room 取得失敗なのか
- next meeting memo enqueue / process の失敗なのか

を一目で切り分けにくい。

## やること

- route / service で使える軽い operation context helper を追加する
- `recording-lock`, `student-room`, `next-meeting-memo` の error response に `stage` と `operationId` を載せる
- server log も同じ `operationId` で出す
- 失敗時の日本語メッセージは保ちつつ、デバッグ用の識別子を増やす

## 完了条件

- 主経路の失敗で段階が分かる
- UI と server log を同じ operationId で突き合わせられる
- 再現時の調査コストが下がる

## ラベル

- `backend`
- `quality`
- `ops`
- `priority:high`
