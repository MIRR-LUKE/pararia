# eval で「盛り」と「固有名詞崩れ」を検知できるようにする

## 状態

- 実装済み
- GitHub Issue: `#24`
- 最終更新: `2026-03-27`

## 前提

- 今の eval は形式寄りなので、faithfulness を見られるようにする
- 「見出しが綺麗」だけで PASS しない
- reviewed transcript を使う価値もテストで確認できるようにする

## 何をするか

fixtures と eval を強化して、盛り・unsupported claim・proper noun 崩れを検知できるようにする。

## なぜやるか

今のままだと、

- transcript にないことを書いても見逃しやすい
- 固有名詞が崩れても検知しにくい
- reviewed transcript を入れる価値を数字で見にくい

という問題がある。

## やること

- noisy transcript ケースを追加する
- proper noun 崩れケースを追加する
- unsupported claim の検知を追加する
- proper noun retention の検知を追加する
- fallback が意味を足していないか確認する
- reviewed transcript を使ったケースも追加する

## 受け入れ条件

- 「見出しが綺麗」だけで PASS しない
- 盛りを検知できる
- proper noun 崩れを検知できる
- reviewed transcript を使う価値がテストで確認できる

## 今回入れた内容

- eval fixture に proper noun 崩れと reviewed transcript 比較ケースを追加した
- unsupported claim 判定を、具体語と proper noun 寄りで見るようにした
- reviewed transcript を使ったときの score 差分を見られるようにした
- rubric の基本情報チェックを強化して、名前や学校名の崩れを見つけやすくした

## 確認

- `npm run typecheck`
- `npm run test:conversation-eval -- --out .tmp/conversation-eval-report.md`

## ラベル

- `ai`
- `quality`
- `tooling`
- `priority:high`
