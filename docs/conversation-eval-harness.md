# 会話ログ評価ハーネス

`npm run test:conversation-eval` で、固定サンプルの会話から面談ログを生成し、rubric で確認できます。

## 使い方

```bash
npm run test:conversation-eval
```

結果をファイルに残したいときは、`--out` を付けます。

```bash
npm run test:conversation-eval -- --out .tmp/conversation-eval-report.md
```

## 仕組み

- `fixtures/conversation-eval/cases.json` に固定サンプル入力を置く
- `fixtures/conversation-eval/rubric.json` に確認したい項目を置く
- スクリプトが面談用 artifact を生成する
- 生成結果を見出しごとに分けて出すので、差分を追いやすい

## 見るポイント

- 必須の見出しが揃っているか
- 面談ログとして必要な内容がちゃんと入っているか
- 禁止したい表現が入っていないか
- rubric に足りない項目があれば、どこが弱いかすぐわかるか
