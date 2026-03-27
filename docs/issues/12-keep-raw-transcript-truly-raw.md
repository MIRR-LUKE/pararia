# 生文字起こしを本当にそのまま残すようにする

## 状態

- 実装済み
- GitHub Issue: `#25`
- 最終更新: `2026-03-27`

## 何をするか

`rawTextOriginal` を名前どおり、本当に生の文字起こしとして扱う。

## なぜやるか

今の main は raw を大事にする方向には寄っていますが、まだ STT 直後に整形が混ざる経路があります。

このままだと、

- raw と display の意味がずれる
- 不具合が起きたときに「もとの文字起こし」が追いにくい
- 命名と実体が合わず、読み手が迷う

という状態が残ります。

## やること

- `rawTextOriginal` には provider の返り値を意味を変えずに保存する
- 改行統一や末尾 trim など、ほぼ元に戻せる軽い整形だけ許す
- `sanitizeTranscriptText()` を raw 保存時に使わない
- `sanitizeTranscriptSegments()` も evidence 用ではなく display 用へ寄せる
- `rawTextCleaned` は display 用の値だと分かる形に整理する
- `pickEvidenceTranscriptText()` は `reviewed -> raw` を基本にし、cleaned を使うなら最後の救済だと明記する

## 完了条件

- raw が本当に raw になっている
- raw をあとから壊さない
- display 用整形と evidence 用原文の責務が分かれている
- 変数名と実体が一致している

## 今回入れた内容

- STT segment の text は内部の空白圧縮をせず、改行統一と trim だけで保持するようにした
- `pickEvidenceTranscriptText()` は `reviewed -> raw` を基本にして、display 側の値は明示 rescue 時だけ使うようにした
- `rawTextCleaned` は legacy の display / preview 用カラムだと分かるコメントを schema と preprocess に入れた
- preview 系は reviewed transcript を優先して見せるように整理した

## 確認

- `npm run typecheck`
- `npm run test:transcript-review`
- `npm run build`

## ラベル

- `backend`
- `ai`
- `architecture`
- `priority:high`
