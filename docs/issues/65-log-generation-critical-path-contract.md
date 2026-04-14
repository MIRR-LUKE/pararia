# ログ生成を protected critical path として repo で守る

## 状態

- Open
- GitHub Issue: `#79`
- 最終更新: `2026-04-14`

## 何をするか

録音ロック、student room、面談ログ生成、次回の面談メモを「壊してはいけない主経路」として定義し、repo のルールと確認項目に固定する。

## なぜやるか

今は別件の開発でも主経路が巻き添えで壊れやすく、原因発見のたびにデバッグコストが跳ねている。

主経路を protected 扱いにしていないため、

- どこを触ると再確認が必要かが曖昧
- 何が最低限の smoke かが人依存
- 壊れてから気づく

が起きている。

## やること

- repo の critical path を文章とコマンドで定義する
- `録音ロック -> session part ingest -> conversation job -> next meeting memo -> student room` を主経路として固定する
- `README` と `docs/engineering-rules.md` に再確認必須項目を追記する
- CI とローカル確認の対象を同じ語彙で揃える

## 完了条件

- 主経路が docs とコマンドの両方で分かる
- 別開発のときに「何を再確認するか」で迷わない
- 後続 issue の CI / guard / error 可視化の土台になる

## ラベル

- `architecture`
- `backend`
- `quality`
- `priority:high`
