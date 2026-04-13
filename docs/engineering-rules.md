# Engineering Rules

更新日: `2026-04-13`

この repo のコードを「速い」「読みやすい」「壊れにくい」状態で保つための基準です。  
雰囲気ではなく、設計・実装・計測の 3 つを揃えて守ります。

## 1. 非交渉ルール

### 1.1 Server First

- 画面の主情報は server component / server function で先に揃える
- above-the-fold の UI に必要なデータで `summary を出してから full を取り直す` をやらない
- 主要画面で人工的な `setTimeout` hydration を入れない

### 1.2 One Screen, One Primary Fetch

- 1 画面の初期表示で、同じ意味のデータを二重取得しない
- 取得ロジックが必要なら `lib/*` に寄せ、route / page に散らさない
- poll は「進行中の仕事があるときだけ」に限定する

### 1.3 Heavy UI Must Split

- client component の責務を `view`, `state orchestration`, `side effects`, `io` に分ける
- 1 ファイルに `録音`, `アップロード`, `lock`, `polling`, `rendering` を全部抱え込まない
- 再利用しないとしても、読解コストが高い塊は hook か helper に切り出す

### 1.4 Memoize Only Real Hot Paths

- `React.memo` は重い subtree にだけ使う
- memo 化する子に anonymous callback を毎 render 渡さない
- `useMemo` / `useCallback` は「依存が安定する」「再描画コストを実際に下げる」場所にだけ使う

### 1.5 Routes Orchestrate, Libraries Decide

- route handler は認可、入力チェック、service 呼び出し、response 整形まで
- ドメイン判断や状態遷移は `lib/*` に置く
- UI 文言と業務ロジックを同じ関数で持たない

### 1.6 Shared Empty / Loading / Error States

- 主要画面は empty / loading / processing / error を同じ語彙で出す
- `失敗しました` だけで終わらせず、次の行動を出す
- 新しい画面を足すときは、既存の shared UI か共通パターンに合わせる

### 1.7 Measured Performance

- 体感が重い画面は「修正して終わり」にしない
- `build` の bundle size と、実ブラウザの遷移時間の両方で確認する
- 性能改善では、まず二重取得・無駄な poll・不要な rerender を潰す

## 2. コード形状の基準

`npm run check:code-shape` を最低限のガードとして使います。

### 2.1 目標 lines

- `app/api/**/route.ts`: `220` 行以内
- `app/**/*Client.tsx`: `320` 行以内
- `app/**/page.tsx`: `180` 行以内
- `components/**/*.tsx`: `260` 行以内
- `lib/**/*.ts`: `260` 行以内
- `scripts/**/*.ts`: `260` 行以内

### 2.2 hard limit

- 通常ファイルは `700` 行を越えない
- route file は `500` 行を越えない
- 既存の巨大ファイルは legacy exception として可視化し、縮小対象として残す

## 3. 現在の重点負債

`2026-04-13` の全体スキャン時点で、優先的に縮めるべきファイル:

1. `app/app/students/[studentId]/StudentSessionConsole.tsx`
2. `lib/jobs/conversationJobs.ts`
3. `lib/jobs/sessionPartJobs.ts`
4. `lib/ai/conversation/generate.ts`
5. `scripts/runpod-measure-ux.ts`
6. `app/app/students/[studentId]/StudentDetailPageClient.tsx`

## 4. 画面性能の基準

### 4.1 Student Detail

- 初期表示は `server-first`
- `StudentSessionConsole` と `StudentDetailWorkspace` は不要な親 render に巻き込まない
- overlay は lazy load してよいが、主導線のカード群は lazy load しない
- build 時の `First Load JS` は `120 kB` 前後を現状 baseline とし、これ以上むやみに増やさない

### 4.2 Polling

- backend job の状態監視だけに使う
- page 非表示時は頻度を落とす
- READY / ERROR / WAITING_COUNTERPART に入ったらすぐ止める

### 4.3 Route Performance Budget

- `Dashboard / Students / Logs / Reports` は route ごとに budget を持つ
- `navigation / loading / empty / populated` は同じ harness で継続計測する
- 比較は `npm run test:route-performance -- --label local` を基本にする
- baseline を残すときは `--baseline` と `--write-baseline` を明示して使う
- field の監視は `/api/rum` に送る Web Vitals と route timing で補完する
- budget の目安は `dashboard 700/1000ms`, `students 450/700ms`, `logs 450/700ms`, `reports 650/900ms`

## 5. PR / commit 前の確認

最低限これを通す:

```bash
npm run typecheck
npm run build
npm run check:code-shape
```

性能まわりを触ったら、可能なら実測も残す:

```bash
tsx scripts/test-navigation-performance.ts --label local
```

field 監視の読み方は [performance-observability.md](./performance-observability.md) にまとめる。

## 6. 今回入れた実例

- Student Detail の `summary -> full` 二重取得をやめた
- `StudentSessionConsole` を memo 化し、親の細かい state 更新で巻き込まれにくくした
- `StudentDetailWorkspace` も memo 化し、overlay や選択 state の更新で無駄に再描画しにくくした
- `check:code-shape` を追加し、巨大ファイルを debt として常時見えるようにした
