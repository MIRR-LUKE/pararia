# Report Delivery Verification

`report-delivery` helper の軽いスモークチェックです。  
状態遷移、表示ラベル、履歴の並びを壊していないかを確認します。

## 実行方法

```bash
npx tsx scripts/verify-report-delivery.ts
```

## 何を検証するか

- `DRAFT` / `REVIEWED` / `SENT` の表示ラベル
- `DRAFT_CREATED` / `REVIEWED` / `SENT` / `FAILED` / `BOUNCED` / `MANUAL_SHARED` / `RESENT` の履歴ラベル
- `draft` / `reviewed` / `sent` / `manual_shared` / `delivered` / `failed` / `bounced` / `resent` の派生状態
- 失敗後の再送、手動共有、配達済みのケース

## 想定

- `app/**` と `prisma/**` に依存しない
- `lib/report-delivery.ts` だけを対象にする
