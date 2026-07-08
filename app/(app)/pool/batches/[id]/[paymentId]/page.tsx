import "server-only";
import type { JSX } from "react";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";

import { requireSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { CSRF_COOKIE_NAME } from "@/lib/auth/csrf";
import { getPaymentDetail, getReceiptJson } from "@/lib/data/payments";
import { Icon } from "@/components/ui/Icon";
import { PoolPaymentDetail } from "@/components/pool/PoolPaymentDetail";

export const dynamic = "force-dynamic";

export default async function PoolPaymentDetailPage({
  params,
}: {
  params: Promise<{ id: string; paymentId: string }>;
}): Promise<JSX.Element> {
  if (!env.ENABLE_POOL_RAIL) notFound();
  await requireSession();
  const { id, paymentId } = await params;

  const payment = await getPaymentDetail(paymentId);
  if (!payment) notFound();

  const receipt = payment.hasReceipt ? await getReceiptJson(paymentId) : null;
  const csrfToken = (await cookies()).get(CSRF_COOKIE_NAME)?.value ?? "";

  return (
    <div className="flex flex-col gap-stack-lg">
      <div>
        <Link href={`/pool/batches/${id}`} className="inline-flex items-center gap-1 text-body-sm text-on-surface-variant hover:text-primary">
          <Icon name="arrow_back" className="text-[16px]" />
          Back to batch
        </Link>
        <h1 className="mt-2 font-geist text-headline-lg text-on-surface">
          Disbursement · {payment.sourceAmount} {payment.sourceAsset}
        </h1>
        <p className="mt-1 text-body-sm text-on-surface-variant">
          Private on-chain payment · {payment.status.toLowerCase().replace("_", " ")}
        </p>
      </div>

      <PoolPaymentDetail payment={payment} initialReceipt={receipt} csrfToken={csrfToken} />
    </div>
  );
}
