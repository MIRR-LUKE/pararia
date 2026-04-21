# 面談ログ -> 保護者レポート生成までを protected generation path として repo で守る

## 状態

- 実装済み
- GitHub Issue: `#79`
- 最終更新: `2026-04-21`

## 何をするか

面談ログの `artifactJson` ができてから、選択済みログを使って保護者レポートを保存するまでを「壊してはいけない生成主経路」として定義し、repo のルールと確認項目に固定する。

## なぜやったか

今は別件の開発でも生成主経路が巻き添えで壊れやすく、原因発見のたびにデバッグコストが跳ねている。

`artifactJson` 正本化や `test:generation-preservation` はすでに入っているが、「面談 -> 保護者レポート」を 1 本の protected path として文章とコマンドで明示し切れていないため、

- どこを触ると `test:generation-preservation` が必須かが曖昧
- `route smoke` と `generation contract gate` の役割が混ざる
- 壊れてから気づく

が起きている。

## いま既に入っている保全

- `ConversationLog.artifactJson` を正本にして、`summaryMarkdown` は派生表示に寄せている
- 保護者レポート生成は壊れた `artifactJson` を markdown fallback で通さない
- `verify` と `Conversation Quality` で `npm run test:generation-preservation` を毎回走らせている

## 今回入ったもの

- README に `ConversationLog.artifactJson -> 選択済みログ -> 保護者レポート` を generation-preservation の主経路として明記した
- `docs/engineering-rules.md` に `test:generation-preservation` を回すべき変更範囲を明記した
- route smoke の critical path と、生成契約の critical path を docs 上で分けて書いた

## 完了条件

- 生成主経路が docs とコマンドの両方で分かる
- 別開発のときに `test:generation-preservation` が必要か迷わない
- 後続 issue の E2E smoke / error 可視化の土台になる

## この issue の外に残ること

- `面談ログ -> generate-report -> 保存済みレポート取得` の E2E smoke は別 issue で扱う
- route の protected critical path に対する smoke / observability 強化も別 issue で扱う

## ラベル

- `architecture`
- `backend`
- `quality`
- `priority:high`
