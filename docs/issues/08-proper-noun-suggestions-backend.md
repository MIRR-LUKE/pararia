# 固有名詞候補推測と reviewed transcript を backend 側に入れる

## 状態

- 実装済み
- GitHub Issue: `#21`
- 最終更新: `2026-03-27`

## 前提

- 今回は UI を実装しない
- 固有名詞だけは全体文脈や辞書から候補推測してよい
- ただし自動確定ではなく、`pending / confirmed / rejected / manually_edited` の状態を持つ
- reviewed transcript は backend だけで生成できるようにする

## 何をするか

proper noun suggestion と reviewed transcript 生成を backend 側に追加して、あとから UI を載せやすい API と状態を用意する。

## なぜやるか

全文を人手で直すのではなく、怪しい固有名詞だけを候補提示できる状態にしたい。

今のままだと、

- 名前や教材名が崩れても backend だけでは救えない
- reviewed transcript を置く場所がない
- 将来 UI を作るときに状態を持ち直す必要がある

という問題がある。

## やること

- proper noun suggestion の仕組みを追加する
- glossary / alias ベースで候補を作れるようにする
- reviewed transcript を自動生成できるようにする
- suggestion ごとに `rawValue / suggestedValue / reason / confidence / status / span or segment reference / source` を持てるようにする
- 最小スコープとして `organization / student / tutor` くらいから始める
- suggestion 取得 service を作る
- confirm / reject / manual override の API を用意する
- reviewed transcript を再生成する service を作る

## 受け入れ条件

- backend だけで proper noun suggestion を作れる
- reviewed transcript を生成できる
- confirmed / rejected / manual override を保存できる
- UI 未実装でも後から使える API 形がある

## 今回入れた内容

- `ProperNounGlossaryEntry` と `ProperNounSuggestion` を追加した
- `organization / student / tutor` を見て glossary と context 候補を組み立てる service を追加した
- alias の全文スキャンと近い表記の候補推測から `reviewedText` を生成するようにした
- `GET/POST /api/conversations/[id]/review` と `PATCH /api/conversations/[id]/review/suggestions/[suggestionId]` を追加した
- `pending / confirmed / rejected / manually_edited` を保存できるようにした

## 確認

- `npm run typecheck`
- `npm run test:transcript-review`
- `npm run build`

## ラベル

- `backend`
- `ai`
- `priority:high`
