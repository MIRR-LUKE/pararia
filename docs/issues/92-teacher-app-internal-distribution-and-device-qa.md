# Teacher App を内部配布して実機 QA を回せるようにする

## 状態

- Open
- GitHub Issue: `#167`
- 最終更新: `2026-04-22`

## 目的

実装が入っても、端末に入れて回せなければ意味がない。  
TestFlight と Play Internal Testing で **校舎テストに出せる状態** まで持っていく。

## 親 issue

- `#171` / `93` Teacher 録音 app を完全ネイティブ前提で作り直す全体計画

## この issue でやること

- iOS は TestFlight、Android は Play Internal Testing で内部配布できる手順を作る
- 校舎責任者向けの初期設定手順を doc 化する
- 実機 QA チェックリストを作る
- 対象端末、OS version、iPhone / Android 差分を表にする
- microphone permission、端末ログイン、録音、未送信再送、logout の確認項目をそろえる
- 現場から返ってくる不具合の報告テンプレートを作る

## 2026-04-21 までに repo へ入ったもの

- internal build handoff 前提の文書として `docs/teacher-app-internal-testing.md` を追加した
- 校舎責任者向けの初期セットアップ手順、main flow / failure QA checklist、不具合報告テンプレートをひとまず repo に置いた
- 実機で閉じるべき項目を `#170`, `#173`, `#165` と分けて追える形にした

## 2026-04-22 に repo へ追加したもの

- `.github/workflows/android-internal-testing.yml` を追加し、手動実行で signed AAB build と Play Internal Testing upload を流せるようにした
- `native/android/app/build.gradle.kts` に release signing の secret 契約を追加した
- `native/android/distribution/whatsnew/` に internal testing 用 release notes を追加した
- `docs/teacher-app-internal-testing.md` を更新し、Play Console / service account / GitHub Secrets / workflow 実行手順を 1 つの文書にまとめた

## 今回のゴール

- 公開ストア審査ではなく **内部テスト運用** を回せること
- 実機で main flow を繰り返し確認できること

## 完了条件

- iOS / Android の内部配布ビルドを責任者へ渡せる
- セットアップ手順と QA 手順が 1 つの文書群で追える
- 現場で詰まりやすい確認項目が事前に潰されている
- Android は Play Console secrets を入れたあと workflow から internal testing build を実際に upload している
