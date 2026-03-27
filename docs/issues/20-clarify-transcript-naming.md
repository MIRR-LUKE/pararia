# transcript 周りの命名を整理して、見ただけで意味が分かるようにする

## 状態

- 実装済み
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

## 今回入れた内容

- `pickStoredDisplayTranscriptSource()` と `pickDisplayTranscriptText()` を追加して display path を明示した
- `pickEvidenceTranscriptText()` に evidence path の意味をコメントで固定した
- `rawTextCleaned` は legacy の display / preview 用カラムだと schema と preprocess に明記した
- `preprocessTranscript()` は `displayTranscript` を返し、保存時だけ `rawTextCleaned` に写す形へ寄せた
- UI / API の preview 系は helper 経由で reviewed transcript を優先するように揃えた
- `session-service` でも evidence transcript と legacy display snapshot の役割を分けて読めるようにした
- `conversation route` の表示 transcript も evidence / display helper に寄せた

## 確認

- `npm run typecheck`
- `npm run test:transcript-preprocess`
- `npm run test:transcript-review`
- `npm run build`

## ラベル

- `refactor`
- `dx`
- `priority:medium`
