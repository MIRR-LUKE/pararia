# transcript 周りの命名を整理して、見ただけで意味が分かるようにする

## 状態

- 未着手
- GitHub Issue: `#33`
- 最終更新: `2026-03-27`

## 何をするか

transcript 周りの名前を整理して、役割が名前からすぐ分かるようにする。

## なぜやるか

今は `rawTextOriginal`、`rawTextCleaned`、`reviewedText`、display 相当の値が混ざりやすく、読む人の負荷が高いです。

ロジック自体が正しくても、

- 名前だけで迷う
- 新しく入った人が追いにくい
- 設計意図がコードから伝わりにくい

という問題が残ります。

## やること

- `rawTextCleaned` を残すなら display 用だと伝わる名前へ寄せる
- helper 名も `evidence / display / reviewed` が分かる名前へ寄せる
- `pickEvidenceTranscriptText()` と `pickDisplayTranscriptText()` の責務を docs 化する
- migration が重ければ、まずはコード内 alias とコメントから整理する

## 完了条件

- transcript 関連の名前で迷いにくい
- 新しく入る人でも読みやすい
- 設計意図がファイル名と関数名に出る

## ラベル

- `refactor`
- `dx`
- `priority:medium`
