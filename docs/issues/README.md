# 直近で切る Issue 一覧

更新日: 2026-03-26

優先順位:

1. runtime data と temp artifacts を repo から追い出す
2. conversation pipeline を責務と session type ごとに分解する
3. 生成品質の評価ハーネスを作る
4. conversation job の冪等性・再試行・観測性を強化する
5. 会話生成物の正本を structured artifact に固定する
6. 削除 / 保存期間ポリシーを整理する

最初に切る 3 本:

- [01-runtime-data-boundary.md](./01-runtime-data-boundary.md)
- [02-split-conversation-pipeline.md](./02-split-conversation-pipeline.md)
- [03-generation-evaluation-harness.md](./03-generation-evaluation-harness.md)

現在の状態:

- `#14` 音声や一時ファイルを Git に入らないようにする: 実装済み
- `#15` 会話ログを作る処理を、役割ごとに分けてわかりやすくする: 実装済み
- `#16` 会話ログの出来を、毎回同じサンプルで確認できるようにする: 実装済み
- `#17` 会話ログのジョブを、失敗や二重実行に強くする: 実装済み
- `#18` 会話ログの正本データを 1 つに決める: 実装済み
- `#19` 削除ルールと保存期間のルールをはっきり決める: 実装済み

最新反映:

- 音声ファイル取り込みは `.mp3` / `.m4a` のみに絞った
- 長尺面談の diarized STT が空で返った場合は、通常 transcription にフォールバックする
- `生成を再開する` で recoverable な文字起こし失敗と session promotion 失敗を再キューできる
- 最新の確認コマンドは `README.md` の smoke check にそろえている

このディレクトリの Markdown は、GitHub Issue の本文更新にも使えるように、実装状況と確認内容まで含めて整理しています。
