import "server-only";
import type { JSX } from "react";
import { notFound } from "next/navigation";
import { getPaymentDetail, getReceiptJson } from "@/lib/data/payments";
import { issueCsrfToken } from "@/lib/auth/csrf";
import { PaymentLifecycle } from "@/components/lifecycle/PaymentLifecycle";

export const dynamic = "force-dynamic";

export default async function PaymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  const payment = await getPaymentDetail(id);
  if (!payment) notFound();

  const receipt = payment.hasReceipt ? await getReceiptJson(id) : null;
  const csrfToken = issueCsrfToken();

  return <PaymentLifecycle payment={payment} initialReceipt={receipt} csrfToken={csrfToken} />;
}
