# Next.js を Active LTS に上げて App Router の最新 perf 基盤に乗せる

## 状態

- 実装済み
- GitHub Issue: `#63`
- 最終更新: `2026-04-13`

## 目的

`Next 14.0.4` は unsupported なので、Active LTS へ上げて App Router の最新基盤に寄せる。

## この issue でやること

- Next.js / React 系依存を Active LTS に更新する
- `next.config` と app router 周辺の互換調整を入れる
- build / typecheck / route perf を通して回帰を止める

## 今回入れた内容

- `Next.js 16.2.3` / `React 19.2.5` / `eslint-config-next 16.2.3` に更新した
- `next.config.mjs` を `serverExternalPackages` 前提へ更新し、build は `next build --webpack` に固定した
- App Router 側の request API を `await params` / `await searchParams` へ寄せて新しい非同期シグネチャへそろえた
- `revalidateTag(tag, "max")` へ更新し、Next 16 の API 契約に合わせた
- `proxy.ts` に移して `middleware` 非推奨 warning を解消した
- `pages/build-compat.tsx` を足して Windows 環境でも `pages-manifest` が安定して出るようにした

## 確認

- `npm run typecheck`
- `npm run build`
- production route perf: tighter budget 全通過

## 完了条件

- production build が通る
- 主要導線に回帰がない
- perf regression がない
- 今後の最適化を古い runtime 制約なしで進められる
