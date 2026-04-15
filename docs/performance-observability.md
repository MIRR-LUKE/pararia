# Performance Observability

この repo では、`lab` と `field` の両方で UX を見ます。

## 何を送るか

- `web-vital`
  - `CLS`
  - `INP`
  - `LCP`
  - `FCP`
  - `TTFB`
- `route-timing`
  - route が描画し直されてから安定するまでの目安
  - `pathname` / `search` 単位で送る

## 送信先

- `POST /api/rum`
- ペイロードは軽い JSON 1 件
- ブラウザは `navigator.sendBeacon` を優先し、失敗時だけ `fetch keepalive` に落とす
- 既定では送らない
- 送るときは `NEXT_PUBLIC_PARARIA_RUM_ENABLED=1`
- 送信量を間引くときは `NEXT_PUBLIC_PARARIA_RUM_SAMPLE_RATE=0.1` のように 0〜1 で指定する
- サーバーログへ残すときだけ `PARARIA_RUM_LOG_ENABLED=1`
- ログ量を間引くときは `PARARIA_RUM_LOG_SAMPLE_RATE=0.1` のように指定する

## ルート budget

`Dashboard / Students / Logs / Reports` は、`load / empty / populated` で継続計測します。

| scenario | target | hard |
| --- | --- | --- |
| dashboard populated | 700ms | 1000ms |
| students populated | 450ms | 700ms |
| students empty search | 400ms | 650ms |
| logs populated | 450ms | 700ms |
| logs empty student | 450ms | 800ms |
| reports populated | 650ms | 900ms |
| reports empty filter | 500ms | 850ms |

## ローカル確認

```bash
npm run test:route-performance -- --label local
```

## 運用の見方

- `route-timing` は field の最初の異常検知に使う
- `web-vital` は本当の体感劣化を掴む
- lab の harness は再現性の高い回帰検知に使う
- budget を超えたら、二重取得 / 重い client component / 不要な poll の順で疑う
