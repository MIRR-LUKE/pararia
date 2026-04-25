# Android Teacher App の field diagnostics と失敗追跡を足す

## 状態

- Closed / repo-side done
- GitHub Issue: `#189`
- 最終更新: `2026-04-25`

## 2026-04-25 に repo へ入ったもの

- Android app に `TeacherDiagnostics` を追加
- Logcat tag `ParariaTeacherDiag` の安定 event trail を追加
- app/bootstrap/login/refresh/create recording/recorder/upload/pending/retry/poll/confirm/done/error を記録
- `recordingId`, `deviceLabel`, `route`, `attemptCount`, `appVersion`, `buildNumber` を可能な範囲で付与
- error dialog / pending screen に折りたたみ式の調査メモとコピー導線を追加
- pending item に attempt count を表示
- `docs/teacher-app-internal-testing.md` に logcat / 調査メモ / QA evidence の取り方を追加

## 残りの実機確認

実機で `adb logcat -s ParariaTeacherDiag`、network off pending/retry、error/pending screen の調査メモコピーを確認する。これは `#188` / `#170` の端末 QA に吸収する。

## 目的

校舎端末で失敗したときに、画面録画だけに頼らず原因を追えるようにする。

## なぜ今やるか

Android app は録音 / upload / pending retry / student confirm までの形が見えてきた。次に怖いのは、現場で「止まった」「送れなかった」「どこまで進んだかわからない」状態になること。

先に全 lifecycle を作り込むより、失敗を短時間で特定できる diagnostics を入れるほうが現場投入には効く。

## やること

- Android app 内で recording event trail を持つ
- error 表示に recordingId / deviceLabel / appVersion / buildNumber / pending attempt count を含める
- logcat で拾える tag / message を整理する
- backend 側にも native client metadata が残っていることを確認する
- QA 報告テンプレートに diagnostics 情報の取り方を追加する

## 完了条件

- main flow / upload failure / auth refresh failure / pending retry の各失敗点を event trail で追える
- QA 報告だけで recordingId と app build を特定できる
- 先生向け UI は怖くしすぎず、責任者向けの調査情報だけ取り出せる
