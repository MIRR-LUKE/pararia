# 世界水準SaaS品質 証跡インデックス

最終更新: 2026-04-26

## 目的

この文書は、PARARIA を「日本向けサービスだが、上場企業が見ても保守管理・コード品質・運用品質で引けを取らない SaaS」にするための証跡インデックスである。対象は GitHub Issue `#193` から `#204` のエンタープライズ基盤群とし、各 Issue をどの文書、回帰テスト、運用証跡で閉じるかを固定する。

Android 現場投入の `#188` / `#191` は、signed release APK と A142 実機・初回校舎 QA の実行証跡が揃った。`#192` は、`#193` から `#204` の repo-side 証跡と Android 現場投入証跡が揃った親ロードマップとして close 候補にする。

## 機械可読の証跡定義

以下の JSON は `npm run test:enterprise-readiness-evidence` が読み取る正本である。新しい証跡文書や gate を足す場合は、Issue 番号と一緒にこのブロックを更新する。

```json enterprise-readiness-evidence
{
  "schemaVersion": 1,
  "lastReviewed": "2026-04-26",
  "scope": "japan-market-saas-with-world-class-code-logic-maintenance-quality",
  "trackingIssue": 192,
  "closeableIssues": [193, 194, 195, 197, 198, 199, 200, 201, 202, 203, 204],
  "fieldEvidenceIssues": [188, 191],
  "officialReferences": [
    {
      "id": "owasp-asvs",
      "title": "OWASP Application Security Verification Standard",
      "url": "https://owasp.org/www-project-application-security-verification-standard/",
      "appliesTo": [193, 194]
    },
    {
      "id": "owasp-api-top-10-2023",
      "title": "OWASP API Security Top 10 2023",
      "url": "https://owasp.org/API-Security/editions/2023/en/0x11-t10/",
      "appliesTo": [193, 194]
    },
    {
      "id": "nist-ssdf",
      "title": "NIST SP 800-218 Secure Software Development Framework",
      "url": "https://csrc.nist.gov/pubs/sp/800/218/final",
      "appliesTo": [193, 204]
    },
    {
      "id": "google-sre-slo",
      "title": "Google SRE Service Level Objectives",
      "url": "https://sre.google/sre-book/service-level-objectives/",
      "appliesTo": [195, 200, 204]
    },
    {
      "id": "opentelemetry",
      "title": "OpenTelemetry Observability",
      "url": "https://opentelemetry.io/",
      "appliesTo": [195]
    },
    {
      "id": "nist-ai-rmf",
      "title": "NIST AI Risk Management Framework 1.0",
      "url": "https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10",
      "appliesTo": [201]
    },
    {
      "id": "owasp-llm-top-10",
      "title": "OWASP Top 10 for Large Language Model Applications",
      "url": "https://owasp.org/www-project-top-10-for-large-language-model-applications/",
      "appliesTo": [201]
    },
    {
      "id": "ppc-offshore-guideline",
      "title": "個人情報保護委員会 外国にある第三者への提供編",
      "url": "https://www.ppc.go.jp/personalinfo/legal/guidelines_offshore",
      "appliesTo": [197, 198, 203]
    }
  ],
  "evidence": [
    {
      "issue": 193,
      "title": "SaaSセキュリティ基準",
      "primaryDocs": ["docs/security-control-matrix.md", "docs/tenant-isolation-audit.md", "docs/release-governance.md"],
      "gates": ["test:security-headers", "test:tenant-isolation-boundaries", "test:maintenance-route-guards", "scan:secrets", "check:code-shape"],
      "acceptance": ["ASVS/API Top 10/SSDF への対応方針が説明できる", "認証・認可・CSRF・テナント境界・監査・ヘッダーの回帰 gate がある"]
    },
    {
      "issue": 194,
      "title": "マルチテナント分離監査",
      "primaryDocs": ["docs/tenant-isolation-audit.md", "docs/security-control-matrix.md"],
      "gates": ["test:tenant-isolation-boundaries", "test:admin-operator-permissions"],
      "acceptance": ["校舎内 ADMIN と platform operator を分離する", "organizationId 境界と親子整合性を自動検査する"]
    },
    {
      "issue": 195,
      "title": "本番監視・SLO・アラート・インシデント手順",
      "primaryDocs": ["docs/production-slo-runbooks.md", "docs/performance-observability.md", "docs/admin-console-platform-spec.md"],
      "gates": ["test:route-performance", "test:rum-route", "test:admin-platform-performance"],
      "acceptance": ["SLI/SLO/Severity/Runbook が一貫している", "Platform Admin と Backup/DR も監視対象に含める"]
    },
    {
      "issue": 197,
      "title": "プライバシー / コンプライアンスパック",
      "primaryDocs": ["docs/privacy-compliance-pack.md", "docs/data-location-and-subprocessors.md", "docs/data-lifecycle-operations.md", "docs/data-retention-policy.md"],
      "gates": ["test:enterprise-readiness-evidence"],
      "acceptance": ["日本向けサービスとして説明する", "委託先・越境移転・保存削除・安全管理措置を提出できる"]
    },
    {
      "issue": 198,
      "title": "データライフサイクル",
      "primaryDocs": ["docs/data-lifecycle-operations.md", "docs/data-retention-policy.md", "docs/db-backup-recovery.md"],
      "gates": ["test:enterprise-readiness-evidence", "test:backup-restore-drill"],
      "acceptance": ["取得から削除・契約終了までの責任分界がある", "backup 内データの扱いと削除完了証跡を説明できる"]
    },
    {
      "issue": 199,
      "title": "バックアップと災害復旧",
      "primaryDocs": ["docs/disaster-recovery-evidence.md", "docs/db-backup-recovery.md", ".github/workflows/backup-runtime-and-db.yml", ".github/workflows/backup-restore-drill.yml"],
      "gates": ["test:backup-restore-drill", "test:migration-safety"],
      "acceptance": ["DB と Blob を別系統で守る", "RTO/RPO と restore drill 証跡テンプレートがある"]
    },
    {
      "issue": 200,
      "title": "負荷・スケール・コスト検証",
      "primaryDocs": ["docs/load-scale-cost-plan.md", "docs/production-slo-runbooks.md", "docs/performance-observability.md"],
      "gates": ["test:load-scale-cost-plan", "test:route-performance", "test:admin-platform-performance"],
      "acceptance": ["10/50/200 同時録音と 40 tenant を前提にする", "provider へ実負荷をかける前の静的 cost/backpressure gate がある"]
    },
    {
      "issue": 201,
      "title": "STT/LLM AIガバナンス",
      "primaryDocs": ["docs/ai-governance-evals.md", "docs/conversation-eval-harness.md", "docs/release-governance.md"],
      "gates": ["test:conversation-eval", "test:generation-preservation", "test:runpod-worker-ready"],
      "acceptance": ["STT/LLM の変更を release 変更として扱う", "model/prompt/runtime の rollback と eval 証跡を残す"]
    },
    {
      "issue": 202,
      "title": "エンタープライズ契約・請求書払い運用",
      "primaryDocs": ["docs/enterprise-contracting-invoice-ops.md", "docs/privacy-compliance-pack.md", "docs/data-location-and-subprocessors.md", "docs/production-slo-runbooks.md"],
      "gates": ["test:enterprise-readiness-evidence"],
      "acceptance": ["決済ゲートウェイを使わず直販・請求書払いを前提にする", "契約・SLA・停止・更新・オフボードの台帳がある"]
    },
    {
      "issue": 203,
      "title": "データ所在地・委託先・越境移転説明",
      "primaryDocs": ["docs/data-location-and-subprocessors.md", "docs/privacy-compliance-pack.md", "docs/disaster-recovery-evidence.md"],
      "gates": ["test:enterprise-readiness-evidence"],
      "acceptance": ["国内向け SaaS と国外委託可能性を矛盾なく説明する", "委託先変更通知と導入先確認事項を持つ"]
    },
    {
      "issue": 204,
      "title": "リリース統制と変更管理",
      "primaryDocs": ["docs/release-governance.md", "docs/production-slo-runbooks.md", "docs/disaster-recovery-evidence.md"],
      "gates": ["test:migration-safety", "test:enterprise-readiness-evidence", "scan:secrets", "check:code-shape"],
      "acceptance": ["release 種別、凍結条件、rollback 条件を明文化する", "migration、AI、Runpod、backup の high-risk gate を分ける"]
    }
  ]
}
```

## Issue 別の判断

| Issue | 閉じる判断 | 根拠 |
| --- | --- | --- |
| `#193` | Repo 側完了 | セキュリティ統制表、テナント境界監査、セキュリティヘッダー、secret scan、code shape gate が揃った |
| `#194` | Repo 側完了 | 校舎内 admin と platform operator の分離、自動境界検査、DB 読み取り整合性検査がある |
| `#195` | Repo 側完了 | SLO、SEV、日次/週次/月次、Platform Admin、Backup/DR、AI incident の runbook がある |
| `#197` | 実務草案として完了 | 法務レビュー前提だが、導入審査に出す説明パックが揃った |
| `#198` | Repo 側完了 | 取得、処理、保持、削除、停止、契約終了、例外管理、証跡台帳まで一貫している |
| `#199` | Repo 側完了 | DB/Blob の二系統 backup、RTO/RPO、restore drill、DR evidence template がある |
| `#200` | 静的計画 gate として完了 | 本番へ負荷をかけず、10/50/200 同時録音、40 tenant、cost、quota、backpressure を固定した |
| `#201` | Repo 側完了 | STT/LLM の評価、変更承認、rollback、incident、eval artifact が定義済み |
| `#202` | 運用設計として完了 | 直販・請求書払い、契約、SLA、停止、更新、オフボードを定義した |
| `#203` | 実務草案として完了 | 国内向け SaaS と国外委託可能性、委託先台帳、変更通知、導入先確認事項がある |
| `#204` | Repo 側完了 | release 種別、凍結条件、high-risk gate、rollback、hotfix 例外がある |

## 運用で継続する証跡

これらの Issue を閉じても、次は継続運用で残す。

- 月次の restore drill と RTO/RPO 実績。
- 月次の権限棚卸し、platform operator 棚卸し、保守鍵棚卸し。
- 四半期の委託先・リージョン・学習利用設定レビュー。
- model、prompt、Runpod image、migration を含む high-risk release の二者承認。
- 顧客導入時の契約、DPA、SLA、請求条件、オフボード条件の個別合意。

## まだ閉じないもの

`#188` と `#191` は repo 側の preflight だけでは終わらない。signed release APK、実機での録音、田中太郎テストアカウント相当の本番導線、初回校舎 QA の証跡が揃った段階で閉じる。
