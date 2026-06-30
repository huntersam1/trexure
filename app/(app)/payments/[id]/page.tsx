import "server-only";
import type { JSX } from "react";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getPaymentDetail, getReceiptJson } from "@/lib/data/payments";
import { CSRF_COOKIE_NAME } from "@/lib/auth/csrf";
import { PaymentLifecycle } from "@/components/lifecycle/PaymentLifecycle";
import { DemoReplayController } from "@/components/demo/DemoReplayController";
import { SAMPLE_INTENT_ID } from "@/lib/demo/replay";

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
  // Use the real double-submit token from the cookie set at login (assertCsrf
  // compares header === cookie); a freshly issued token would not match.
  const csrfToken = (await cookies()).get(CSRF_COOKIE_NAME)?.value ?? "";
  const isSample = payment.intentId === SAMPLE_INTENT_ID;

  return (
    <div className="flex flex-col gap-stack-md">
      {isSample && (
        <div className="flex justify-end">
          <DemoReplayController
            paymentId={payment.id}
            intentId={payment.intentId}
            amount={payment.sourceAmount}
            currency={payment.targetCurrency}
            recipientRef={payment.id}
            csrfToken={csrfToken}
          />
        </div>
      )}
      <PaymentLifecycle payment={payment} initialReceipt={receipt} csrfToken={csrfToken} />
    </div>
  );
}
