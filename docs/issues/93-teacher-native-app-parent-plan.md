# Teacher 録音 app を完全ネイティブ前提で作り直す全体計画

## 状態

- Open
- GitHub Issue: `#171`
- 最終更新: `2026-04-21`

## 先に結論

Teacher 側の録音 app は、**web を包むのではなく完全ネイティブ**で作る。  
管理画面、運用画面、レポート確認、設定、監査は既存 web をそのまま使う。

分け方は次のとおり。

1. 録音 app: iOS / Android の完全ネイティブ app
2. backend: 既存 PARARIA repo を継続利用
3. admin: 既存 web を継続利用

## この方針にする理由

- 一番壊れてはいけないのは録音そのもの
- microphone permission、interrupt、background / foreground、再送は native の方が制御しやすい
- Teacher App は画面数が少なく、管理機能も載せないので native 2 面でも責務が保ちやすい
- backend と admin web は今の資産を流用できる

## 今回やること

- native app と web admin の責務境界を固定する
- native app 用の backend 契約と device auth を切る
- iOS native 録音 app を MVP まで作る
- Android native 録音 app を MVP まで作る
- 録音 lifecycle hardening と内部配布 QA を native 前提にやり切る

## やらないこと

- WebView / Capacitor / PWA を本命にすること
- 管理画面を native に移植すること
- backend を別 repo / 別基盤に作り直すこと
- 先生向け app に管理画面の機能を持ち込むこと

## 実装順

- `#172` / `94` native app 用 backend 契約と device auth を固める - 完了
- `#173` / `95` iOS native Teacher App の録音基盤と最小 UI を作る
- `#170` / `96` Android native Teacher App の録音基盤と最小 UI を作る
- `#165` / `91` native 録音 lifecycle を harden する
- `#167` / `92` 内部配布と実機 QA を回せるようにする

## 2026-04-21 時点の進捗

- `#172` backend 契約と device auth は完了済み
- `#173` iOS は source foundation に加えて、queue hardening と Xcode project 前段 resources / config を repo に追加済み
- `#170` Android は source foundation に加えて、queue metadata、forced refresh、foreground service type 指定を repo に追加済み
- `#165` は実装前提の lifecycle policy doc を `docs/teacher-app-lifecycle-policy.md` に切り出した
- `#167` は internal testing guide を `docs/teacher-app-internal-testing.md` に追加した

## 完了条件

- Teacher 録音 app が iOS / Android で完全ネイティブとして動く
- 端末ログイン、録音、ローカル保持、upload、再送、生徒確認が app 内で完結する
- backend は既存 PARARIA を使い、admin / report / settings は web のまま残る
- TestFlight / Play Internal Testing で内部配布できる
- 現場 QA の結果をもとに main flow の不安定点を追える
