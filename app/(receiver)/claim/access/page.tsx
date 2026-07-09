import type { JSX } from "react";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { env } from "@/lib/env";
import { requireReceiver } from "@/lib/receiver/session";
import { revealClaimLink } from "@/lib/receiver/claim-link";
import { CSRF_COOKIE_NAME } from "@/lib/auth/csrf";
import { Icon } from "@/components/ui/Icon";
import { ClaimForm } from "../ClaimForm";

export const dynamic = "force-dynamic";

/**
 * Emailed claim-link landing (#81). The receiver arrives here from the email
 * CTA. Middleware has already forced a receiver login (preserving `?t=`), so by
 * the time we render, the caller is authenticated AND holds the token — only
 * then do we decrypt + reveal the note and pre-fill the claim form.
 */
export default async function ClaimAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}): Promise<JSX.Element> {
  if (!env.ENABLE_POOL_RAIL) notFound();
  await requireReceiver();
  const { t } = await searchParams;
  const revealed = await revealClaimLink(typeof t === "string" ? t : "");
  const csrfToken = (await cookies()).get(CSRF_COOKIE_NAME)?.value ?? "";

  if (!revealed) {
    return (
      <div className="flex flex-col gap-stack-lg">
        <div className="rounded-xl border border-outline-variant bg-surface px-4 py-10 text-center">
          <Icon name="link_off" className="text-[32px] text-on-surface-variant" />
          <h1 className="mt-2 font-geist text-headline-sm text-on-surface">This claim link isn&apos;t valid</h1>
          <p className="mx-auto mt-1 max-w-prose text-body-md text-on-surface-variant">
            The link may have expired, already been used, or been mistyped. Check your inbox, or paste
            the note directly on the claim page.
          </p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <Link href={"/claim/inbox" as Route} className="text-body-sm text-primary font-bold hover:underline">
              Go to your inbox
            </Link>
            <Link href="/claim" className="text-body-sm text-primary font-bold hover:underline">
              Claim with a note
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-stack-lg">
      <div>
        <h1 className="font-geist text-headline-lg text-on-surface">Claim your payment</h1>
        <p className="mt-1 text-body-md text-on-surface-variant max-w-prose">
          <strong className="text-on-surface">
            {revealed.payment.sourceAmount} {revealed.payment.sourceAsset}
          </strong>{" "}
          from {revealed.payment.payerName || "a Trexure workspace"}. We filled in your note from the
          secure link — just choose where to be paid.
        </p>
      </div>
      <ClaimForm csrfToken={csrfToken} initialNote={revealed.note} />
    </div>
  );
}
