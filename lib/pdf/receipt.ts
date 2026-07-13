import "server-only";
import PDFDocument from "pdfkit";

const PLUM = "#8E44AD";
const GOLD = "#D4AF37";
const INK = "#1A1025";
const MUTED = "#5B4A70";

type Line = { label: string; value: string };

/**
 * Render a §6.4 receipt object to PDF bytes. Brand colors are applied as raw hex
 * here because PDF output has no Tailwind theme — this is the one allowed place
 * to use hex, scoped to PDF rendering only. Uses pdfkit core fonts (no font files
 * to bundle in the Railway build).
 */
export function renderReceiptPdf(receipt: Record<string, unknown>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const r = receipt as Record<string, any>;

    // Header band — wordmark + Payment Confirmed
    doc.rect(0, 0, doc.page.width, 8).fill(PLUM);
    doc.fillColor(INK).fontSize(22).text("Trexure", 56, 40);
    doc.fillColor(GOLD).fontSize(11).text("PAYMENT CONFIRMED", 56, 70);

    // Settled total (gold = value/settlement)
    const dest = r.amounts?.destination ?? {};
    doc.fillColor(MUTED).fontSize(10).text("TOTAL SETTLED", 56, 110);
    doc.fillColor(PLUM).fontSize(28).text(`${dest.currency ?? ""} ${dest.value ?? ""}`, 56, 124);

    const lines: Line[] = [
      { label: "Receipt ID", value: String(r.id ?? "") },
      { label: "Payment ID", value: String(r.paymentId ?? "") },
      { label: "Status", value: String(r.status ?? "") },
      { label: "Created", value: String(r.created ?? "") },
      { label: "Corridor", value: `${r.corridor?.from ?? ""} -> ${r.corridor?.to ?? ""}` },
      { label: "Source", value: `${r.amounts?.source?.currency ?? ""} ${r.amounts?.source?.value ?? ""}` },
      { label: "Destination", value: `${dest.currency ?? ""} ${dest.value ?? ""}` },
      { label: "FX rate", value: `${r.fx?.rate ?? ""} (as of ${r.fx?.asOf ?? ""})` },
      { label: "Network fee", value: String(r.fees?.network ?? "") },
      { label: "Anchor fee", value: String(r.fees?.anchor ?? "") },
      { label: "Platform fee", value: String(r.fees?.platform ?? "") },
      { label: "Slippage", value: String(r.slippage ?? "") },
      { label: "On-chain tx", value: String(r.onchain?.txHash ?? "") },
      { label: "Ledger", value: String(r.onchain?.ledger ?? "") },
      { label: "Proof hash", value: String(r.onchain?.proofHash ?? "") },
      { label: "Asset", value: String(r.onchain?.asset ?? "") },
      { label: "Fiat provider", value: String(r.fiat?.provider ?? "") },
      { label: "Fiat reference", value: String(r.fiat?.reference ?? "") },
      { label: "Bank reference", value: String(r.fiat?.bankRef ?? "") },
      // Treasury Float Yield (#161 P4) — only when the payment earned yield.
      ...(r.yield
        ? [
            { label: "Yield asset", value: `${r.yield.asset ?? ""} (${r.yield.status ?? ""})` },
            { label: "Yield principal", value: String(r.yield.principal ?? "") },
            { label: "Yield accrued", value: String(r.yield.accrued ?? "") },
            { label: "Yield platform fee", value: `${r.yield.platformFee ?? ""} (${r.yield.feeBps ?? "0"} bps)` },
            { label: "Yield net to tenant", value: String(r.yield.netYield ?? "") },
            { label: "Yield swap slippage", value: String(r.yield.slippage ?? "") },
            { label: "Yield sweep-in tx", value: String(r.yield.sweepInTx ?? "") },
            { label: "Yield sweep-out tx", value: String(r.yield.sweepOutTx ?? "") },
          ]
        : []),
      { label: "Shielded", value: String(r.privacy?.shielded ?? "") },
      { label: "View key disclosed", value: String(r.privacy?.viewKeyDisclosed ?? "") },
    ];

    let y = 175;
    for (const ln of lines) {
      doc.fillColor(MUTED).fontSize(9).text(ln.label.toUpperCase(), 56, y);
      doc.fillColor(INK).fontSize(11).font("Courier").text(ln.value, 200, y, { width: 320 });
      doc.font("Helvetica");
      y += 22;
    }

    doc.fillColor(MUTED).fontSize(8).text("Secured by Enclave Protocol", 56, doc.page.height - 64);
    doc.end();
  });
}
