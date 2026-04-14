# UI: エラー・空状態・生成中状態の表示を全部そろえる

## 状態

- 実装済み
- GitHub Issue: `#42`
- 最終更新: `2026-04-13`

## 何のための画面か

空、失敗、途中の状態でも、ユーザーが迷わないようにする。

## 全画面で必要な状態

- まだ何もない
- 読み込み中
- 生成中
- review 待ち
- エラー
- 再実行できる
- 一時的に途中で止まっている

## いま入っているもの

- Student Detail は loading / error / empty を明示し、再読込導線も出している
- 録音まわりは `生成中 / 再送 / 再開` の導線が画面内にある
- Reports / Students / Settings にも最低限の empty / loading 表示は入っている

## 今回そろえたもの

- Reports 画面の empty / loading / error / processing を同じ語彙と UI で出すようにした
- `PageLoadingState` に `aria-busy` と `role=status` を付けて、読み込み状態の意味を揃えた
- transcript review / report dashboard / Student Detail で「次に押す導線」を残す形に寄せた

## 大事なこと

- `失敗しました` だけで終わらないこと
- 次に押すボタンがあること
- 生成中は放置してよいのか分かること

## 完了条件

- 主要画面で状態の出し方がそろう
- 空状態、途中状態、失敗状態でユーザーが次の行動を判断できる
- 再実行や見直しの導線が必ず用意される
