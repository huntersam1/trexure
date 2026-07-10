import "server-only";
import type { JSX } from "react";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getPaymentDetail, getReceiptJson } from "@/lib/data/payments";
import { CSRF_COOKIE_NAME } from "@/lib/auth/csrf";
import { PaymentLifecycle } from "@/components/lifecycle/PaymentLifecycle";
import { DemoReplayController } from "@/components/demo/DemoReplayController";
import { RetryReconcileButton } from "@/components/payments/RetryReconcileButton";
import { VerifyProofButton } from "@/components/zk/VerifyProofButton";
import { ShareDisclosureButton } from "@/components/payments/ShareDisclosureButton";
import { Icon } from "@/components/ui/Icon";
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
            amount={payment.targetAmount ?? payment.sourceAmount}
            currency={payment.targetCurrency}
            recipientRef={payment.id}
            csrfToken={csrfToken}
          />
        </div>
      )}
      {payment.status === "FAILED" && (
        <div className="rounded-lg border border-error/30 bg-error-container/40 p-stack-md flex items-center justify-between gap-stack-md">
          <span className="text-body-sm text-error font-medium">
            Payout failed. Reconciliation did not complete.
          </span>
          <RetryReconcileButton paymentId={payment.id} csrfToken={csrfToken} />
        </div>
      )}
      {payment.shielded && <VerifyProofButton paymentId={payment.id} csrfToken={csrfToken} />}
      {payment.status === "SETTLED" && (
        <div className="flex justify-end gap-2">
          <a
            href={`/api/reports/attestation?paymentId=${payment.id}&format=pdf`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant px-4 py-2 text-body-sm font-medium text-on-surface hover:border-primary/40 hover:text-primary"
          >
            <Icon name="verified" className="text-[18px]" />
            Proof of payment (PDF)
          </a>
          <a
            href={`/api/reports/attestation?paymentId=${payment.id}&format=json`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant px-4 py-2 text-body-sm font-medium text-on-surface hover:border-primary/40 hover:text-primary"
          >
            <Icon name="data_object" className="text-[18px]" />
            JSON
          </a>
          <ShareDisclosureButton paymentId={payment.id} csrfToken={csrfToken} />
        </div>
      )}
      <PaymentLifecycle payment={payment} initialReceipt={receipt} csrfToken={csrfToken} />
    </div>
  );
}
