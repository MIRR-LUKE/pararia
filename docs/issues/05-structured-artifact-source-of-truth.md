# 会話ログの正本データを 1 つに決める

## 状態

- 実装済み
- GitHub Issue: `#18`
- 最終更新: `2026-03-27`

## 何をするか

会話ログまわりで「どのデータを正本として扱うか」をはっきり決める。

Markdown を正本にするのではなく、構造化された JSON の形を正本に寄せる。

## なぜやるか

今のままだと、次のものが混ざりやすい。

- 生成直後のデータ
- 整形後のデータ
- 画面表示用の文面
- report 用に組み直したデータ

これだと不具合が出たときに、

- どこで壊れたのか
- 何が本当の元データなのか

がわかりにくい。

## やること

- 正本となる schema を決める
- DB にどう保存するか決める
- Markdown は派生物として扱う
- UI は正本データから表示を作る
- 再構成ロジックも正本データを参照するようにする

## 終わったといえる状態

- [x] 正本の schema が定義されている
- [x] 保存形式がばらけない
- [x] Markdown が主データではなくなる
- [x] 不具合時にどの段階で崩れたか追いやすい

## 今回入れたもの

- `ConversationLog.artifactJson` を追加した
- `lib/conversation-artifact.ts` で schema と render / parse を定義した
- 会話ログ生成は `artifactJson` を先に作り、`summaryMarkdown` は後から render する派生表示として扱うようにした
- operational log と parent report が `artifactJson` を優先参照するようにした
- markdown の見た目が弱いときに本文から正本を作り直すのではなく、artifact 先行の主経路を維持するようにした

## 確認

- `npm run typecheck`
- `npm run build`

## ラベル

- `backend`
- `ai`
- `architecture`
- `priority:medium`
