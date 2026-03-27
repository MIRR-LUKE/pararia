# 固有名詞の辞書を「内部用」と「外部 STT に渡す用」に分ける

## 状態

- 実装済み
- GitHub Issue: `#26`
- 最終更新: `2026-03-27`

## 何をするか

固有名詞の辞書を 2 つの役割に分けて、精度と安全性を両立させる。

## なぜやるか

固有名詞対策として phrase list や custom vocabulary を使うのは王道ですが、provider に送る辞書へ個人情報を混ぜるのは避けたいです。

このままだと、

- 生徒名や保護者名を外部 provider に送りやすい
- 安全に使いたい語と、内部だけで持ちたい語が混ざる
- 将来 provider hint を入れるときに設計がぶれやすい

という問題が残ります。

## やること

- glossary を `内部辞書` と `外部 STT ヒント用辞書` に分ける
- 内部辞書では、生徒名、保護者名、講師名、学校名、教材名などを持てるようにする
- 外部 STT ヒント用では、学校名、教材名、模試名、サービス名などを中心にする
- 生徒名や保護者名を provider に送るのは明示 opt-in にする
- suggestion ロジックは内部辞書をフル活用する
- 将来 provider hint を入れるときの切り替えポイントを service に切る
- glossary entry に `sendToProvider` か同等のフラグを持たせる

## 完了条件

- 内部辞書と外部 STT ヒント用辞書が分かれている
- PII を誤って provider 側に流しにくい
- suggestion 精度を保ちながら安全性を上げられる

## 今回入れた内容

- `ProperNounGlossaryEntry.sendToProvider` を追加した
- 内部辞書候補は `loadInternalGlossaryCandidates()` に集約した
- provider に渡してよい語だけを返す `listProviderHintTerms()` を追加した
- context 由来の生徒名や講師名は provider hint に混ぜず、内部 suggestion だけで使うようにした

## 確認

- `npm run prisma:migrate:deploy`
- `npm run test:transcript-review`
- `npm run typecheck`

## ラベル

- `backend`
- `security`
- `ai`
- `priority:high`
