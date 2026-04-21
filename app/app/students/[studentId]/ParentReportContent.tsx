"use client";

import { StructuredMarkdown } from "@/components/ui/StructuredMarkdown";
import styles from "./studentDetail.module.css";

type Props = {
  reportJson?: unknown | null;
  markdown?: string | null;
};

type CurrentParentReportJson = {
  salutation: string;
  selfIntroduction: string;
  reportLead: string;
  openingParagraph: string;
  detailParagraphs: string[];
  closingParagraph: string;
  signatureLines: string[];
};

type LegacyParentReportJson = {
  greeting?: string;
  summary?: string;
  sections?: Array<{
    title?: string;
    body?: string;
  }>;
  closing?: string;
};

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asTextList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => asText(entry)).filter(Boolean);
}

function isCurrentParentReportJson(value: unknown): value is CurrentParentReportJson {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    asText(candidate.salutation).length > 0 &&
    asText(candidate.reportLead).length > 0 &&
    asText(candidate.openingParagraph).length > 0 &&
    asText(candidate.closingParagraph).length > 0 &&
    asTextList(candidate.detailParagraphs).length >= 4
  );
}

function normalizeLegacySections(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const section = entry as Record<string, unknown>;
      const title = asText(section.title);
      const body = asText(section.body);
      if (!title && !body) return null;
      return { title, body };
    })
    .filter((entry): entry is { title: string; body: string } => Boolean(entry));
}

function isLegacyParentReportJson(value: unknown): value is LegacyParentReportJson {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    asText(candidate.greeting).length > 0 ||
    asText(candidate.summary).length > 0 ||
    normalizeLegacySections(candidate.sections).length > 0 ||
    asText(candidate.closing).length > 0
  );
}

function CurrentParentReportView({ report }: { report: CurrentParentReportJson }) {
  const detailParagraphs = asTextList(report.detailParagraphs).slice(0, 4);
  const signatureLines = asTextList(report.signatureLines);

  return (
    <div className={styles.parentReportLayout}>
      <div className={styles.parentReportHeader}>
        <p className={styles.parentReportGreeting}>{report.salutation}</p>
        {report.selfIntroduction ? <p className={styles.parentReportIntro}>{report.selfIntroduction}</p> : null}
      </div>

      <div className={styles.parentReportBody}>
        <p className={styles.parentReportLead}>{report.reportLead}</p>
        <p className={styles.parentReportParagraph}>{report.openingParagraph}</p>
        {detailParagraphs.map((paragraph, index) => (
          <p key={`${index}-${paragraph.slice(0, 24)}`} className={styles.parentReportParagraph}>
            {paragraph}
          </p>
        ))}
        <p className={styles.parentReportParagraph}>{report.closingParagraph}</p>
        <p className={styles.parentReportFixedGreeting}>今後ともどうぞよろしくお願いいたします。</p>

        {signatureLines.length > 0 ? (
          <div className={styles.parentReportSignature}>
            {signatureLines.map((line) => (
              <p key={line} className={styles.parentReportSignatureLine}>
                {line}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LegacyParentReportView({ report }: { report: LegacyParentReportJson }) {
  const sections = normalizeLegacySections(report.sections);

  return (
    <div className={styles.parentReportLayout}>
      {report.greeting ? (
        <div className={styles.parentReportHeader}>
          <p className={styles.parentReportGreeting}>{report.greeting}</p>
        </div>
      ) : null}

      <div className={styles.parentReportBody}>
        {report.summary ? <p className={styles.parentReportParagraph}>{report.summary}</p> : null}
        {sections.map((section) => (
          <section key={`${section.title}-${section.body.slice(0, 24)}`} className={styles.parentReportSection}>
            {section.title ? <h4 className={styles.parentReportSectionTitle}>{section.title}</h4> : null}
            {section.body ? <p className={styles.parentReportParagraph}>{section.body}</p> : null}
          </section>
        ))}
        {report.closing ? <p className={styles.parentReportParagraph}>{report.closing}</p> : null}
      </div>
    </div>
  );
}

export function ParentReportContent({ reportJson, markdown }: Props) {
  if (isCurrentParentReportJson(reportJson)) {
    return <CurrentParentReportView report={reportJson} />;
  }

  if (isLegacyParentReportJson(reportJson)) {
    return <LegacyParentReportView report={reportJson} />;
  }

  return <StructuredMarkdown markdown={markdown} emptyMessage="まだ保護者レポートは生成されていません。" />;
}
