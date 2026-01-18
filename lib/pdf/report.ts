import PDFDocument from "pdfkit";

type PdfInput = {
  studentName: string;
  organizationName?: string;
  periodFrom?: string;
  periodTo?: string;
  markdown: string;
  keyQuotes?: string[];
};

export async function generateReportPdfBase64(input: PdfInput): Promise<string> {
  const doc = new PDFDocument({ size: "A4", margin: 48 });
  const chunks: Buffer[] = [];

  doc.on("data", (chunk) => chunks.push(chunk as Buffer));

  const headerOrg = input.organizationName ?? "PARARIA";
  const period =
    input.periodFrom || input.periodTo
      ? `${input.periodFrom ?? "前回以降"} 〜 ${input.periodTo ?? "今回まで"}`
      : "前回以降の会話ログ";

  doc.fontSize(16).text(headerOrg, { align: "right" });
  doc.moveDown(0.5);
  doc.fontSize(22).text(`${input.studentName} さん 保護者向けレポート`, { align: "left" });
  doc.fontSize(12).fillColor("#475569").text(`期間: ${period}`);
  doc.moveDown();

  doc.fillColor("#0f172a").fontSize(14).text("今月（今期間）の要点");
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor("#1e293b");
  input.markdown
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .slice(0, 20)
    .forEach((line) => doc.text(line, { lineGap: 2 }));

  if (input.keyQuotes?.length) {
    doc.moveDown();
    doc.fillColor("#0f172a").fontSize(14).text("根拠引用（重要発言）");
    doc.moveDown(0.3);
    doc.fontSize(11).fillColor("#1e293b");
    input.keyQuotes.slice(0, 5).forEach((q) => doc.text(`• ${q}`, { lineGap: 2 }));
  }

  doc.end();
  await new Promise((resolve) => doc.on("end", resolve));
  const buffer = Buffer.concat(chunks);
  return buffer.toString("base64");
}


