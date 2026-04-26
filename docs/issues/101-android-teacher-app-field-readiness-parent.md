# Android Teacher App を現場投入できるところまで仕上げる

## 状態

- Open
- GitHub Issue: `#191`
- 作成日: `2026-04-25`

## 目的

Teacher 録音 app は当面 Android-only で現場投入まで進める。iOS / TestFlight / App Store は現時点では scope 外にする。

## 方針

- Android native app を先に校舎端末で使えるところまで持っていく
- Play Internal Testing は任意。最短は signed APK の直配り
- iOS は必要になった時点で新 Issue として再開する
- 管理画面、運用画面、レポート確認、設定、監査は既存 web のまま残す

## 子 Issue

- `#170` Android native Teacher App の録音基盤と最小 UI を作る
- `#188` Android Teacher App の signed APK handoff と初回校舎 QA を完了する
- `#189` Android Teacher App の field diagnostics と失敗追跡を足す - Closed / repo-side done
- `#190` Teacher App の端末管理と紛失時 revoke 導線を管理画面に足す - Closed

## 2026-04-25 進捗

- Android diagnostics は repo 側実装と compile 確認まで完了
- 端末管理 / revoke は settings UI / API / focused test まで完了
- signed APK handoff workflow は preflight / signature verification / checksum artifact まで補強済み
- Android debug build は成功
- A142 / Android 16 へ debug APK を install し、launch / session restore / standby 表示まで確認
- 横向きで録音ボタンが画面外へ押し出される実機問題を見つけ、portrait 固定を追加
- 通話中に録音開始した場合は、server recording を作る前に端末側で止める guard を追加
- debug APK で `record -> pause -> resume -> stop -> upload -> Runpod STT -> confirm -> done -> standby` が通った
- recordingId: `cmoebrriy0001lxle1pfthnvn`
- local pending upload は 0 件に戻ることを確認
- production env から `RUNPOD_API_KEY` を一時 pull し、Runpod pod `scel1ckkaq7882` が `desiredStatus=EXITED` に戻っていることを確認

## 2026-04-26 進捗

- signed APK handoff 用の GitHub Actions Secrets / Variable を登録済み
- `test:android-release-handoff-preflight` は repo / workflow / signing secret 名 / Windows tool detection / docs を確認し、失敗ゼロ
- `Android Device Handoff` run `24949663628` で signed release APK artifact を生成済み
- CI と local の `apksigner verify` は pass
- APK SHA-256: `105a2399c3459b0f5d06d2c064131809bf0a1cf3abe10be602e5a428b79a412b`
- 残りは Android 実機 install / launch / QA evidence

## close 条件

- Android release APK を校舎端末へ渡せる
- Android 実機で `login -> record -> upload -> confirm -> done` が通る - debug APK done
- pending retry / logout / failed upload の戻り導線が確認済み
- 失敗時に recordingId / device / app build まで追える - repo-side done
- 紛失端末や退役端末を管理画面から revoke できる - done

## scope 外

- iOS native app
- TestFlight
- App Store release
- Play Store public release
- campus-wide rollout automation
