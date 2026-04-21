# progress / log polling を read-only に寄せ、手入力 transcript を one-shot で進める

## 状態

- Closed
- GitHub Issue: `#153`
- 最終更新: `2026-04-18`

## 何をするか

session progress と log view の通常監視を read-only polling に寄せ、worker wake は本当に必要な場面だけに絞る。あわせて、手入力 transcript は保存 API だけで promotion 開始まで進むようにする。

## なぜやるか

進捗画面やログ画面の poll が `POST` を繰り返す形だと、見るだけで副作用が走り、二重実行や不要な wake を呼びやすい。

手入力 transcript も追加の progress kick を待つ構造だと、保存直後に何も進まず止まったように見える。

## やること

- session progress の wake 条件を初回と stalled `RECEIVED` に絞る
- log view の polling を `GET` ベースの read-only 監視へ戻す
- 手入力 transcript 保存時に promotion job を開始する
- dispatch の回帰テストを増やす

## 完了条件

- 進捗画面とログ画面を開いただけで不要な mutation が走らない
- 手入力 transcript が追加 kick なしで先に進む
- polling / dispatch の回帰テストで壊れにくくなっている
