# コード形状ガードと分割ルールを repo に定着させる

## 状態

- 実装済み
- GitHub Issue: `#45`
- 最終更新: `2026-04-13`

## 何をするか

コードの美しさを「気分」ではなく、repo のルールとして残す。

## 今回入れた内容

- `docs/engineering-rules.md` を追加した
- `npm run check:code-shape` を追加した
- file size の target / hard limit / legacy exception を可視化した
- README からルールへ辿れるようにした

## 今回進めたこと

- `lib/runpod/worker-control.ts` を `core` / `ops` に分割した
- `scripts/runpod-measure-ux.ts` を `core` / `runpod` / `worker` に分割した
- `Student Detail` 側でも formatting / action queue を切り出して、巨大 client の責務を少しずつ減らした

## 次の重点負債

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
