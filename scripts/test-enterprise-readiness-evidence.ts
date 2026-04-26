import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

type EvidenceReference = {
  id: string;
  title: string;
  url: string;
  appliesTo: number[];
};

type IssueEvidence = {
  issue: number;
  title: string;
  primaryDocs: string[];
  gates: string[];
  acceptance: string[];
};

type EnterpriseReadinessEvidence = {
  schemaVersion: number;
  lastReviewed: string;
  scope: string;
  trackingIssue: number;
  closeableIssues: number[];
  fieldEvidenceIssues: number[];
  officialReferences: EvidenceReference[];
  evidence: IssueEvidence[];
};

const root = process.cwd();
const evidencePath = path.join(root, "docs", "enterprise-readiness-evidence.md");
const packagePath = path.join(root, "package.json");

const expectedCloseableIssues = [193, 194, 195, 197, 198, 199, 200, 201, 202, 203, 204];
const expectedReferenceIds = [
  "owasp-asvs",
  "owasp-api-top-10-2023",
  "nist-ssdf",
  "google-sre-slo",
  "opentelemetry",
  "nist-ai-rmf",
  "owasp-llm-top-10",
  "ppc-offshore-guideline",
];

const requiredDocTerms: Array<{ file: string; terms: string[] }> = [
  {
    file: "docs/security-control-matrix.md",
    terms: ["OWASP ASVS", "OWASP API Security Top 10 2023", "NIST SSDF", "AUTH-", "TENANT-", "WEB-"],
  },
  {
    file: "docs/tenant-isolation-audit.md",
    terms: ["organizationId", "scripts/test-tenant-isolation-boundaries.ts", "PlatformOperator"],
  },
  {
    file: "docs/production-slo-runbooks.md",
    terms: ["SLO", "SEV-1", "Platform Admin", "Backup Restore Drill"],
  },
  {
    file: "docs/privacy-compliance-pack.md",
    terms: ["個人情報保護", "委託先", "越境移転", "請求書払い"],
  },
  {
    file: "docs/data-location-and-subprocessors.md",
    terms: ["個人情報保護委員会", "外国にある第三者への提供", "委託先台帳", "越境移転"],
  },
  {
    file: "docs/data-lifecycle-operations.md",
    terms: ["エクスポート", "契約終了", "削除完了証跡", "証跡台帳"],
  },
  {
    file: "docs/disaster-recovery-evidence.md",
    terms: ["RPO", "RTO", "Backup Restore Drill", "DB と Blob"],
  },
  {
    file: "docs/load-scale-cost-plan.md",
    terms: ["200同時録音", "40 tenants", "backpressure", "cost per audio minute/hour"],
  },
  {
    file: "docs/ai-governance-evals.md",
    terms: ["NIST AI RMF", "OWASP Top 10 for LLM", "model 変更", "rollback"],
  },
  {
    file: "docs/enterprise-contracting-invoice-ops.md",
    terms: ["請求書払い", "SLA", "契約台帳", "決済ゲートウェイ"],
  },
  {
    file: "docs/release-governance.md",
    terms: ["Release 種別", "変更凍結条件", "rollback plan", "test:migration-safety"],
  },
];

function extractEvidence(markdown: string): EnterpriseReadinessEvidence {
  const match = markdown.match(/```json enterprise-readiness-evidence\s+([\s\S]*?)```/);
  assert.ok(match, "docs/enterprise-readiness-evidence.md must include a json enterprise-readiness-evidence block");
  return JSON.parse(match[1]) as EnterpriseReadinessEvidence;
}

function resolveRepoPath(relativePath: string) {
  return path.join(root, relativePath);
}

function assertIncludesAll(source: string, label: string, values: string[]) {
  for (const value of values) {
    assert.ok(source.includes(value), `${label} must include ${value}`);
  }
}

async function readText(relativePath: string) {
  const fullPath = resolveRepoPath(relativePath);
  assert.ok(existsSync(fullPath), `missing file: ${relativePath}`);
  return readFile(fullPath, "utf8");
}

async function main() {
  const [markdown, packageJsonRaw] = await Promise.all([
    readFile(evidencePath, "utf8"),
    readFile(packagePath, "utf8"),
  ]);
  const evidence = extractEvidence(markdown);
  const packageJson = JSON.parse(packageJsonRaw) as { scripts?: Record<string, string> };
  const scripts = packageJson.scripts ?? {};

  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.lastReviewed, "2026-04-26");
  assert.equal(evidence.scope, "japan-market-saas-with-world-class-code-logic-maintenance-quality");
  assert.equal(evidence.trackingIssue, 192);
  assert.deepEqual([...evidence.closeableIssues].sort((left, right) => left - right), expectedCloseableIssues);
  assert.deepEqual([...evidence.fieldEvidenceIssues].sort((left, right) => left - right), [188, 191]);

  const referenceIds = evidence.officialReferences.map((reference) => reference.id).sort();
  assert.deepEqual(referenceIds, [...expectedReferenceIds].sort(), "official references must stay complete");
  for (const reference of evidence.officialReferences) {
    assert.ok(reference.title.length > 0, `${reference.id} title is required`);
    assert.ok(reference.url.startsWith("https://"), `${reference.id} must use https`);
    assert.ok(reference.appliesTo.length > 0, `${reference.id} must apply to at least one issue`);
  }

  const issueEntries = new Map(evidence.evidence.map((entry) => [entry.issue, entry]));
  for (const issue of expectedCloseableIssues) {
    const entry = issueEntries.get(issue);
    assert.ok(entry, `missing evidence entry for #${issue}`);
    assert.ok(entry.title.length > 0, `#${issue} title is required`);
    assert.ok(entry.primaryDocs.length >= 2, `#${issue} must include at least two primary docs`);
    assert.ok(entry.gates.length >= 1, `#${issue} must include at least one gate`);
    assert.ok(entry.acceptance.length >= 2, `#${issue} must include concrete acceptance notes`);

    for (const docPath of entry.primaryDocs) {
      assert.ok(existsSync(resolveRepoPath(docPath)), `#${issue} references missing doc/workflow: ${docPath}`);
    }
    for (const gate of entry.gates) {
      assert.ok(scripts[gate], `#${issue} references missing npm script: ${gate}`);
    }
  }

  for (const { file, terms } of requiredDocTerms) {
    const source = await readText(file);
    assertIncludesAll(source, file, terms);
  }

  const issueReadme = await readText("docs/issues/README.md");
  assertIncludesAll(issueReadme, "docs/issues/README.md", [
    "世界水準SaaS品質 証跡インデックス",
    "#193",
    "#204",
    "#188",
    "#191",
  ]);

  console.log("enterprise readiness evidence checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
