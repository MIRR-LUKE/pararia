# faithfulness テストを CI の品質ゲートにする

## 状態

- 未着手
- GitHub Issue: `#32`
- 最終更新: `2026-03-27`

## 何をするか

`test:conversation-eval` を CI に組み込んで、盛ったログや固有名詞崩れを PR の時点で止められるようにする。

## なぜやるか

今の eval はかなり良くなっていますが、任意実行のままだと品質ゲートとしては弱いです。

このままだと、

- コードは通るがログ品質が落ちる
- reviewed transcript を使う価値が壊れても気づきにくい
- fallback の盛りが入り込んでも見逃しやすい

という問題が残ります。

## やること

- `test:conversation-eval` を CI に組み込む
- fail 条件を決める
- unsupported claim が一定以上なら落とす
- proper noun retention が一定以下なら落とす
- reviewed transcript で改善しない場合は落とす
- fallback hallucination が出たら落とす
- レポートを artifact として保存する
- fixture は増やしすぎず、代表ケースに絞る

## 完了条件

- faithfulness の悪化を PR で止められる
- eval が運用の一部になる
- 「コードは通るけど品質が落ちた」を減らせる

## ラベル

- `ai`
- `quality`
- `ci`
- `priority:medium`
