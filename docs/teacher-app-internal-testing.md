# Teacher App internal testing guide

更新日: `2026-04-21`

Teacher 録音 app は公開ストア前に、校舎共通端末での内部 QA を回します。  
ここでは iOS TestFlight / Play Internal Testing 前提の最小運用をまとめます。

## 対象

- 校舎責任者
- QA 担当
- 開発者

## 配布前チェック

### 共通

- backend の `PARARIAApiBaseURL` が staging / production のどちらかで明示されている
- device auth 用アカウントを用意している
- 校舎名が分かる端末ラベルを使う
- microphone permission 文言が実運用向けになっている

### iOS

- bundle id
- signing team
- TestFlight 用 build number
- `PARARIA_API_BASE_URL` の build setting

### Android

- applicationId
- release signing
- `PARARIA_BASE_URL` gradle property
- notification / microphone permission の確認

## 校舎責任者向けセットアップ手順

1. app を端末へ入れる
2. 初回だけ校舎用アカウントでログインする
3. 端末名を `校舎名-端末名` 形式で設定する
4. 待機画面まで進み、未送信 0 件を確認する
5. テスト録音を 1 回流し、`録音 -> 解析 -> 生徒確認 -> 完了` を確認する

## QA checklist

### main flow

- [ ] login
- [ ] standby から録音開始
- [ ] 録音中 timer が進む
- [ ] 録音終了後に analyzing へ遷移
- [ ] 生徒候補が表示される
- [ ] confirm 後に done へ遷移する
- [ ] 数秒後に standby へ戻る

### failure / recovery

- [ ] microphone denied
- [ ] network off で upload failure
- [ ] pending queue から retry
- [ ] logout 後に bootstrap へ戻る

### device-specific

- [ ] 画面ロック中の挙動
- [ ] app background / foreground 復帰
- [ ] phone call / alarm 介入
- [ ] Bluetooth / 有線マイクの route change
- [ ] Android notification visibility

## 不具合報告テンプレート

```txt
端末:
OS:
app version:
校舎:
再現手順:
期待結果:
実際の結果:
録音は残ったか:
未送信一覧に出たか:
スクリーンショット / 動画:
```

## close 条件との関係

- `#167` は、この文書と internal build handoff が揃って初めて close 候補
- `#170` / `#173` は、ここに沿った実機 main flow 確認が終わるまで open のまま
