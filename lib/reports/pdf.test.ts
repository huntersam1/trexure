import { describe, it, expect } from "vitest";
import { renderReportPdf, type ReportDoc } from "./pdf";

describe("renderReportPdf", () => {
  it("produces a non-trivial PDF buffer for a report with tables", async () => {
    const doc: ReportDoc = {
      title: "Reconciliation Statement",
      subtitle: "Tenant t1",
      summary: [
        { label: "Period", value: "2026-07-01 to 2026-07-31" },
        { label: "Settled payments", value: "2" },
      ],
      tables: [
        {
          heading: "Settled payments",
          columns: ["Date", "Counterparty", "Amount"],
          rows: [["2026-07-10", "Acme Vendor", "100 XLM"]],
        },
        { heading: "Exceptions", columns: ["Date", "Status"], rows: [] },
      ],
    };
    const pdf = await renderReportPdf(doc);
    expect(pdf).toBeInstanceOf(Buffer);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(800);
  });
});
