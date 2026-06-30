import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { assertCsrf } from "@/lib/auth/csrf";
import { forTenant } from "@/lib/db";
import { renderReceiptPdf } from "@/lib/pdf/receipt";
import { putObject, getSignedDownloadUrl } from "@/lib/storage";
import { problem, AppError } from "@/lib/http/problem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    assertCsrf(req);
    const user = await requireSession();
    const { id } = await ctx.params;
    const db = forTenant(user.tenantId);

    const payment = await db.payment.findFirst({ where: { id }, include: { receipt: true } });
    if (!payment) throw new AppError(404, "Payment not found");
    if (!payment.receipt) throw new AppError(409, "Receipt not generated yet");

    const pdf = await renderReceiptPdf(payment.receipt.json as Record<string, unknown>);
    const key = `receipts/${user.tenantId}/${payment.receipt.id}.pdf`;
    await putObject(key, pdf, "application/pdf");
    await db.receipt.update({ where: { id: payment.receipt.id }, data: { pdfKey: key } });

    const url = await getSignedDownloadUrl(key, 600);
    return NextResponse.json({ url }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    return problem(400, "Bad Request", "Could not export receipt PDF");
  }
}
