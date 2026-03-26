# 音声や一時ファイルを Git に入らないようにする

## 状態

- 実装済み
- GitHub Issue: `#14`

## 何をするか

音声アップロード、録音中の chunk、一時ファイル、検証用の出力などを、ソースコードとは別の場所に置くようにする。

## なぜやるか

今のままだと、動かしている途中でできるファイルが repo に混ざりやすい。

そのままだと次の問題が起きる。

- 個人情報を含むファイルが Git に入る
- レビューに関係ない差分が増える
- `.data/` や `.tmp/` が増えて管理しづらい
- デプロイするコードと運用データの境目があいまいになる

## やること

- `.data/` を Git で追わないようにする
- `.tmp/` を Git で追わないようにする
- 音声や一時ファイルの保存先を 1 か所にまとめる
- 保存先を `PARARIA_RUNTIME_DIR` で切り替えられるようにする
- README に「どこに保存されるか」を書く
- すでに Git に入ってしまっている runtime file を管理対象から外す

## 終わったといえる状態

- [x] `.data/` と `.tmp/` が Git 差分に出ない
- [x] ローカルで録音やアップロードをしても repo が汚れない
- [x] 新しく入った人でも保存先ルールが README を見ればわかる

## 今回入れたもの

- runtime 保存先を `PARARIA_RUNTIME_DIR` で切り替えられるようにした
- 音声 upload / live chunk / manifest の保存先を共通化した
- `.data/` と `.tmp/` を `.gitignore` に入れ、既存追跡分も Git 管理から外した
- README と `.env.example` にローカル保存ルールを追記した

## 確認

- `npm run typecheck`
- `npm run build`

## ラベル

- `infra`
- `security`
- `tech-debt`
- `priority:high`
