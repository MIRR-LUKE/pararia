# duplicate enqueue でも active job と last good artifact を壊さない

## 状態

- Closed
- GitHub Issue: `#155`
- 最終更新: `2026-04-18`

## 何をするか

conversation / session promotion / next meeting memo の enqueue が重なっても、すでに `QUEUED` / `RUNNING` の仕事を潰さず、同じ transcript なら既存 artifact を消さないようにする。

## なぜやるか

再生成や再開が重なった時に active job を消して積み直すと、実行中の処理が見えなくなったり、最後の正常成果物まで空になる危険がある。

同じ transcript から conversation を作り直すだけで既存 artifact を消すのも、ユーザー体験として弱い。

## やること

- active な job は preserve して duplicate enqueue をやり過ごす
- next meeting memo は active job があれば再キューだけ抑止する
- 同一 transcript の conversation では artifact を初期化しない
- queue ownership と dispatch の回帰テストを入れる

## 完了条件

- active job を誤って消さない
- 同じ材料で既存 artifact が空にならない
- duplicate enqueue の回帰テストがある
