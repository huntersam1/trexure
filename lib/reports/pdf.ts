import "server-only";
import PDFDocument from "pdfkit";

/**
 * Generic report PDF renderer for the reporting layer (R1–R5), modeled on
 * `lib/pdf/receipt.ts`. Renders a titled document with an optional summary
 * (label/value grid) and any number of tables (heading + column headers +
 * rows), paginating automatically. Brand hex is applied here because PDF output
 * has no Tailwind theme — the one allowed place to use hex, scoped to PDF only.
 * Uses pdfkit core fonts (no font files to bundle in the Railway build).
 */

const PLUM = "#8E44AD";
const GOLD = "#D4AF37";
const INK = "#1A1025";
const MUTED = "#5B4A70";

export type ReportSummaryLine = { label: string; value: string };
export type ReportTable = { heading: string; columns: string[]; rows: string[][] };
export type ReportDoc = {
  title: string;
  subtitle?: string;
  summary?: ReportSummaryLine[];
  tables: ReportTable[];
};

const MARGIN = 40;

export function renderReportPdf(report: ReportDoc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGIN, layout: "landscape" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = MARGIN;
    const right = doc.page.width - MARGIN;
    const contentWidth = right - left;
    const bottom = doc.page.height - MARGIN;

    // Header band — wordmark + report title.
    doc.rect(0, 0, doc.page.width, 8).fill(PLUM);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(20).text("Trexure", left, 28);
    doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(11).text(report.title.toUpperCase(), left, 54);
    if (report.subtitle) {
      doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(report.subtitle, left, 70);
    }

    let y = 92;

    // Summary grid (two columns of label/value).
    if (report.summary && report.summary.length > 0) {
      const colW = contentWidth / 2;
      report.summary.forEach((line, i) => {
        const x = left + (i % 2) * colW;
        if (i % 2 === 0 && i > 0) y += 16;
        doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(line.label.toUpperCase(), x, y, {
          width: colW - 8,
          continued: false,
        });
        doc
          .fillColor(INK)
          .font("Helvetica-Bold")
          .fontSize(10)
          .text(line.value, x + 130, y - 1, { width: colW - 138 });
      });
      y += 28;
    }

    const ensureSpace = (needed: number) => {
      if (y + needed > bottom) {
        doc.addPage();
        y = MARGIN;
      }
    };

    for (const table of report.tables) {
      ensureSpace(48);
      doc.fillColor(PLUM).font("Helvetica-Bold").fontSize(12).text(table.heading, left, y);
      y += 18;

      const colCount = table.columns.length || 1;
      const colW = contentWidth / colCount;

      // Column header row.
      doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(7);
      table.columns.forEach((c, i) => {
        doc.text(c.toUpperCase(), left + i * colW, y, { width: colW - 4, lineBreak: false });
      });
      y += 13;
      doc.moveTo(left, y).lineTo(right, y).strokeColor("#E5DFEC").lineWidth(0.5).stroke();
      y += 4;

      if (table.rows.length === 0) {
        doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(8).text("— none —", left, y);
        y += 16;
      } else {
        doc.font("Courier").fontSize(7.5);
        for (const row of table.rows) {
          ensureSpace(14);
          doc.fillColor(INK);
          row.forEach((cell, i) => {
            doc.text(cell, left + i * colW, y, { width: colW - 4, lineBreak: false, ellipsis: true });
          });
          y += 13;
        }
      }
      y += 14;
    }

    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text("Secured by Enclave Protocol", left, bottom + 6);
    doc.end();
  });
}
