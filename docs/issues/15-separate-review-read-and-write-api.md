# review API を「読む」と「変える」で正しく分ける

## 状態

- 未着手
- GitHub Issue: `#28`
- 最終更新: `2026-03-27`

## 何をするか

review API の役割を `読む` と `変える` で分けて、意味が素直な API にする。

## なぜやるか

いまは `GET /api/conversations/[id]/review?rebuild=1` で再構築が走るので、GET が更新もしています。

このままだと、

- API の意味が読み取りにくい
- キャッシュや将来のフロント実装で迷いやすい
- 運用時の予想外の更新が起きやすい

という小さいけれど効くズレが残ります。

## やること

- GET は現在状態を読むだけにする
- rebuild は POST に寄せる
- PATCH は suggestion の confirm / reject / manual edit だけにする
- review API の責務を `GET / POST / PATCH` の 3 つに整理する

## 完了条件

- GET に副作用がない
- API の意味が素直に読める
- 将来フロントを載せても迷いにくい

## ラベル

- `backend`
- `api`
- `priority:high`
