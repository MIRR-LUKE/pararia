# ログ生成を evidence-grounded に変えて、fallback でも盛らないようにする

## 状態

- 実装済み
- GitHub Issue: `#22`
- 最終更新: `2026-03-27`

## 前提

- ログ生成は `reviewedTranscript があればそれを優先 / なければ raw transcript` を使う
- ログ生成は「きれいな言い換え」ではなく「根拠つきの教務ログ」に寄せる
- fallback でも意味を盛らない
- `spec.ts / generate.ts / fallback.ts / conversation-artifact.ts / operational-log.ts` の整合を取る

## 何をするか

artifact と prompt を evidence-grounded 前提に寄せて、unsupported claim や rewrite-heavy な生成を減らす。

## なぜやるか

今のままだと、

- spec / generate が rewrite-heavy になりやすい
- retry や fallback でも意味を足しやすい
- artifactJson が markdown 派生寄りで evidence が弱い

という問題がある。

## やること

- prompt を evidence-grounded に変更する
- artifact schema を見直す
- `claims[] / nextActions[] / sharePoints[]` に evidence を持てるようにする
- `claims[]` に `text / type / confidence / sourceSegmentIds / evidenceQuotes` を持てるようにする
- `nextActions[]` に `basis / humanCheckNeeded` を持てるようにする
- `sharePoints[]` に `basis` を持てるようにする
- fallback は transcript にあることだけを書く保守的な出力にする
- markdown は artifact の派生物として扱う

## 受け入れ条件

- unsupported claim が出にくくなる
- fallback が盛らない
- artifact に evidence が残る
- markdown は artifact の派生物として扱える

## 今回入れた内容

- prompt を `根拠:` 前提の出力ルールへ寄せた
- fallback は transcript から拾えた文だけを並べる保守的な形にした
- artifact を `summary / claims / nextActions / sharePoints` に evidence を持てる形へ広げた
- `operational-log` も structured artifact を優先して、盛った補完文を足さないようにした
- conversation job は reviewed transcript を優先して生成するようにした

## 確認

- `npm run typecheck`
- `npm run test:log-render-and-llm-retries`
- `npm run test:conversation-eval -- --out .tmp/conversation-eval-report.md`
- `npm run build`

## ラベル

- `backend`
- `ai`
- `quality`
- `priority:high`
