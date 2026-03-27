# 生文字起こしを壊さず raw / reviewed / display transcript を分離する

## 状態

- 実装済み
- GitHub Issue: `#20`
- 最終更新: `2026-03-27`

## 前提

- 今回は UI を実装しない
- raw transcript は evidence の正本として扱う
- reviewed transcript があれば後段で優先し、なければ raw を使う
- display 用の整形で evidence を壊さない
- 既存 Issue `#14`〜`#19` の設計を壊さない

## 何をするか

STT の生結果を immutable に扱えるようにして、`raw / reviewed / display` の責務を backend 側で分ける。

## なぜやるか

今の destructive な sanitize / preprocess が evidence path に混ざると、

- 元発話の根拠が追えなくなる
- 固有名詞や言い回しが勝手に変わる
- reviewed transcript を入れても、どこが正本かわかりにくい

という状態になりやすい。

## やること

- `ConversationLog` と `SessionPart` で raw transcript を immutable に扱う
- 必要なら `raw transcript / reviewed transcript / display transcript` の役割を分離する
- `sanitizeTranscriptText()` / `sanitizeTranscriptLine()` を evidence path から外し、display 用に寄せる
- `buildSessionTranscript()` が sanitize 済みテキストを主入力にしないようにする
- session 統合時は `reviewed ?? raw` を使う
- raw を保存したあとに cleaned 系の値で上書きしない
- 既存データとの互換を保ちつつ migration を追加する

## 受け入れ条件

- raw transcript は保存後に壊れない
- reviewed transcript があれば後段で使われる
- display 用整形が evidence を壊さない
- 今のログ生成や session promotion が破綻しない

## 今回入れた内容

- `SessionPart` と `ConversationLog` に `reviewedText` と `reviewState` を追加した
- `rawTextOriginal` は sanitize 済み入力で上書きしないようにし、display 系は `rawTextCleaned` に寄せた
- `buildSessionTranscript()` と conversation job は `reviewedText ?? rawTextOriginal` を使うように変えた
- `transcribeAudioForPipeline()` は raw transcript をできるだけそのまま保持し、display 用の前処理は別経路に残した
- cleanup では `reviewedText` と suggestion も一緒に消すようにした

## 確認

- `npm run typecheck`
- `npm run test:session-progress`
- `npm run test:live-transcription`
- `npm run build`

## ラベル

- `backend`
- `ai`
- `architecture`
- `priority:high`
