# Engineering Rules

更新日: `2026-04-21`

この repo のコードを「速い」「読みやすい」「壊れにくい」状態で保つための基準です。  
雰囲気ではなく、設計・実装・計測の 3 つを揃えて守ります。

- Node の基準は `.nvmrc` と `package.json` の `engines.node` に合わせる
- tracked ファイルに秘密値がないかは `npm run scan:secrets` で確認する

## 1. 非交渉ルール

### 1.1 Server First

- 画面の主情報は server component / server function で先に揃える
- above-the-fold に本当に必要な情報は server component / server function で先に揃える
- 生徒詳細のように、最初の表示に軽い一覧情報だけで足りる画面は `summary` で開き、画面が見えているときだけ `full` を静かに取り直してよい
- 主要画面で人工的な `setTimeout` hydration を入れない

### 1.2 One Screen, One Primary Fetch

- 1 画面の初期表示で、同じ意味のデータを二重取得しない
- 取得ロジックが必要なら `lib/*` に寄せ、route / page に散らさない
- poll は「進行中の仕事があるときだけ」に限定する
- poll は最初だけ細かく、その後は経過時間とタブ表示状態で間隔を広げる

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
- field の監視は、必要な期間だけ `NEXT_PUBLIC_PARARIA_RUM_ENABLED=1` で `/api/rum` に Web Vitals と route timing を送って補完する
- RUM のサーバーログは既定では出さず、調査時だけ `PARARIA_RUM_LOG_ENABLED=1` を使う
- budget の目安は `dashboard 700/1000ms`, `students 450/700ms`, `logs 450/700ms`, `reports 650/900ms`

## 5. Protected Critical Path

### 5.1 再確認が必須の主経路

- 生成保全の主経路は `ConversationLog.artifactJson -> 選択済みログ -> 保護者レポート`
- `lib/ai/parentReport*`, `lib/operational-log*`, `app/api/ai/generate-report*`, `app/api/reports*`, `ConversationLog.artifactJson` の契約、再生成 / finalize 保全を触ったら `npm run test:generation-preservation` を回す
- `app/api/ai/generate-report*`, `app/api/reports*`, student room の report 集約を触ったら `npm run test:report-generation-route` も回す
- route の protected critical path は `録音ロック -> session part ingest -> session progress -> student room -> next meeting memo`
- auth、dynamic route params、student room 集約、recording lock、session progress、next meeting memo のどれかを触ったら `npm run test:critical-path-smoke` を回す
- 録音 UI、音声 upload、Runpod handoff、`Runpod stop -> app finalize` の接続を触ったら `npm run test:recording-ui -- --base-url https://pararia.vercel.app --env-file .tmp/.env.production.runpod --fake-audio-path .tmp/recording-ui-70s.wav --skip-navigation-dialog` を deploy 後の正本 smoke として 1 本回す
- CI でも同じ語彙で `Conversation Quality` と `Critical Path Smoke` を回し、ローカルと PR の確認対象をずらさない
- GitHub の `main` branch protection では `conversation-quality`, `critical-path-smoke`, `generation-route-smoke`, `backend-scope-guard` を required status checks に固定する
- 指定した `conversationId / reportId / sessionId` が別の生徒データに化けないことは `npm run test:conversation-route` でも止める

### 5.2 backend/perf branch の path guard

- backend / perf 系ブランチでは UI 変更を混ぜない
- 禁止対象は `app/** (app/api/** を除く)`, `components/**`, `public/**`, `styles/**`, `*.css`, `*.scss`, `*.sass`, `*.less`, `tailwind/postcss config`
- 許可対象は `app/api/**`, `lib/**`, `scripts/**`, `prisma/**`, `.github/**`, `docs/**`
- 例外を作るときだけ `ALLOW_UI_CHANGES=1` を明示する
- guard の自己確認は `npm run test:backend-scope-guard`

### 5.3 Production Integrity Guard

- production / shared tenant に mutating fixture を流さない
- `critical-path` や `student-directory-ui` のような fixture 作成 script は `local app + local DB` 以外では既定で fail する
- 例外を作るときだけ `PARARIA_ALLOW_REMOTE_FIXTURES=1` を明示する
- `prisma/seed.ts` は remote DB に対して既定で fail する。明示 override は `PARARIA_ALLOW_REMOTE_SEED=1`
- deploy 後の read-only canary は `npm run test:student-integrity-audit -- --base-url https://pararia.vercel.app`

## 6. PR / commit 前の確認

最低限これを通す:

```bash
npm run typecheck
npm run build
npm run check:code-shape
npm run scan:secrets
```

性能まわりを触ったら、可能なら実測も残す:

```bash
tsx scripts/test-navigation-performance.ts --label local
```

field 監視の読み方は [performance-observability.md](./performance-observability.md) にまとめる。

## 7. 今回入れた実例

- Student Detail は初回を `scope: "summary"` にして、重い詳細だけ client で静かに取り直す形へ寄せた
- `StudentSessionConsole` を memo 化し、親の細かい state 更新で巻き込まれにくくした
- `StudentDetailWorkspace` も memo 化し、overlay や選択 state の更新で無駄に再描画しにくくした
- `check:code-shape` を追加し、巨大ファイルを debt として常時見えるようにした
- session progress の polling を経過時間で広げ、非表示タブではさらに静かにした
- RUM は既定オフにし、送信量とログ量を env で抑えられるようにした
