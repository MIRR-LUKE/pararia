# prompt cache を本番でも効かせる: 動的メタデータを prefix 後方へ寄せ cached input を回復する

## 状態

- Closed
- GitHub Issue: `#157`
- 最終更新: `2026-04-25`

## 何をするか

production 相当の conversation finalize で `llmCachedInputTokens` が 0 のままになる原因を潰し、prompt cache hit を再現可能にする。

## なぜやるか

2026-04-18 の `runpod:measure-ux` 3 run では `llmCachedInputTokens=0` が 3/3 だった。

一方で、ローカルの面談ログベンチでは同じ音声・同じ prompt 骨格で `13,056 cached input tokens (98.7%)` が出ている。

ローカルコードを見ると、conversation finalize 自体は `prompt_cache_key` と `prompt_cache_retention` を渡しているが、実際の user prompt は先頭に毎回変わるメタデータを置いている。

- `lib/ai/conversation/generate/prompt.ts`
  - `生徒`
  - `講師`
  - `面談日`
  - `面談時間`

が prompt の冒頭に来る

OpenAI 公式 docs では、cache hit は exact prefix match のときだけ成立し、static content を前に、variable content を後ろに置くよう案内されている。現状の本番計測は、生徒名や日時が毎 run 変わるため prefix を壊している可能性が高い。

## やること

- prompt の先頭を static な rules / schema / formatting contract に寄せる
- `生徒名 / 日付 / transcript 本文` など可変部分は prefix の後ろへ移す
- 必要なら `prompt_cache_key` の粒度を `conversation-pipeline:vX:sessionType` などへそろえる
- `runpod:measure-ux` と finalize meta に `promptCacheKey / retention / cachedInputTokens / inputTokens` を必ず残す
- 本番相当の 2 run 以上で cache hit を確認する regression ベンチを足す

## 2026-04-19 進捗

- `prompt.ts` を `v5.3` に上げ、固定ルールと可変メタデータを分ける `cache-stable prefix` 構成にした
- `生徒名 / 講師名 / 面談日 / 面談時間 / transcript` を stable prefix の後ろへ寄せた
- prompt cache namespace の既定値を `conversation-draft` に寄せた
- `generate.ts` で `promptCacheKey / promptCacheRetention / promptCacheStablePrefixChars / promptCacheStablePrefixTokensEstimate` を返すようにした
- `handlers.ts` と `runpod:measure-ux` で上の診断値を `qualityMetaJson` / job cost meta / 計測 JSON に残すようにした
- `run-interview-log-benchmark.ts` は `cold / warm / metadata variant` の 3 本比較を出せるようにした
- `test-conversation-draft-quality.ts` で「metadata が変わっても stable prefix が不変」「system + stable prefix が 1024 tokens 超」を回帰テスト化した

## 2026-04-25 production 相当 3090 実測

- `v5.3` の production 3 run では stable prefix 推定 `1033 tok` でも `llmCachedInputTokens=0` が 3/3 だった
- `v5.4` で固定品質ゲートを stable prefix に追加し、stable prefix 推定を `1384 tok` まで増やした
- local の OpenAI cache smoke では同じ `gpt-5.4` + `prompt_cache_key` で 2 回目に `cached_tokens=3328` を確認した
- production 相当 `v5.4` 3090 run では `run-3` で `llmCachedInputTokens=1792`, `llmCachedInputRatio=0.135` を確認した
- `runpod:measure-summary` の warning は `none`

cached input が production 相当 run で 0 固定から外れたため close。

## 完了条件

- production 相当の連続 run で `llmCachedInputTokens > 0` を再現できる
- cached input ratio が 0% 固定ではなくなる
- README に「cache を効かせる prefix 設計」と「cache miss の見方」が追記されている

## 参考

- OpenAI Prompt Caching guide: https://platform.openai.com/docs/guides/prompt-caching
- OpenAI Latency optimization guide: https://platform.openai.com/docs/guides/latency-optimization
