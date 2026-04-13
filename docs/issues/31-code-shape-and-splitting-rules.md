# コード形状ガードと分割ルールを repo に定着させる

## 状態

- 一部できている
- GitHub Issue: `#45`
- 最終更新: `2026-04-13`

## 何をするか

コードの美しさを「気分」ではなく、repo のルールとして残す。

## 今回入れた内容

- `docs/engineering-rules.md` を追加した
- `npm run check:code-shape` を追加した
- file size の target / hard limit / legacy exception を可視化した
- README からルールへ辿れるようにした

## この issue で進めること

- debt が大きいファイルを順番に分割する
- legacy exception を 1 つずつ消す
- page / route / lib の責務分割を共通ルールにそろえる

## 今の重点負債

- `app/app/students/[studentId]/StudentSessionConsole.tsx`
- `lib/jobs/conversationJobs.ts`
- `lib/jobs/sessionPartJobs.ts`
- `lib/ai/conversation/generate.ts`
- `scripts/runpod-measure-ux.ts`
- `app/app/students/[studentId]/StudentDetailPageClient.tsx`

## 完了条件

- `check:code-shape` が hard limit を超えず、debt の一覧も縮み続ける
- 新しい巨大ファイルが repo に入りにくい
- 「どこに何を書くか」の判断が README / docs から明確に分かる

## 確認

- `npm run check:code-shape`
- `npm run typecheck`
- `npm run build`
