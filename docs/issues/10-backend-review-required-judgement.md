# reviewRequired を backend 側だけで判定できるようにする

## 状態

- 実装済み
- GitHub Issue: `#23`
- 最終更新: `2026-03-27`

## 前提

- 今回は UI を実装しない
- まずは backend だけで `reviewRequired` と理由を返せることを目標にする
- workflow は複雑にしすぎない
- hard stop の要否は config で切れる設計でもよい

## 何をするか

`reviewRequired` とその理由を backend 側だけで判定し、API や quality meta から読めるようにする。

## なぜやるか

UI が未実装でも、

- この transcript は確認した方がいい
- 何が危ないのか

を backend 側だけで判定できないと、後から UI を作りにくい。

## やること

- `reviewRequired` 判定を入れる
- qualityMeta に判定理由を残す
- session / sessionPart / conversation のどこで持つか整理する
- 必要なら review 状態の enum を追加する
- 次の条件を候補として判定する
  - pending の proper noun suggestion がある
  - fallback を使った
  - STT quality warning がある
  - transcript が短すぎる
  - proper noun candidate が多すぎる
  - interview / lesson report の入力が弱い
  - check-in / check-out の片方が弱い

## 受け入れ条件

- backend だけで `reviewRequired` 判定ができる
- なぜ `reviewRequired` なのか理由を返せる
- 今後 UI を作るときにそのまま使える

## 今回入れた内容

- `reviewState` を `SessionPart` と `ConversationLog` に追加した
- `qualityMetaJson.transcriptReview` に `reviewRequired / reasons / pendingSuggestionCount` を残すようにした
- `pending proper noun / fallback used / STT warning / transcript too short / input が弱い` を backend 側で判定するようにした
- conversation API と review API から `reviewState` と理由が読めるようにした

## 確認

- `npm run typecheck`
- `npm run test:transcript-review`
- `npm run test:session-progress`
- `npm run build`

## ラベル

- `backend`
- `ai`
- `quality`
- `priority:medium`
