import type { JSX } from "react";
import type { Route } from "next";
import { redirect, notFound } from "next/navigation";

import { env } from "@/lib/env";
import { getReceiver } from "@/lib/receiver/session";
import { sanitizeNext } from "@/lib/receiver/safe-next";
import { ReceiverAuthForm } from "./ReceiverAuthForm";

export const dynamic = "force-dynamic";

export default async function ReceiverLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}): Promise<JSX.Element> {
  if (!env.ENABLE_POOL_RAIL) notFound();
  const { next } = await searchParams;
  const safeNext = sanitizeNext(next);
  const receiver = await getReceiver();
  if (receiver) redirect(safeNext as Route);

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="bg-surface border border-outline-variant rounded-xl p-8 shadow-xl shadow-black/5">
        <div className="mb-6">
          <h1 className="font-geist text-headline-sm text-on-surface">Receiver access</h1>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            Log in or create a receiver account to claim a payment you were sent.
          </p>
        </div>
        <ReceiverAuthForm next={safeNext} />
      </div>
      <p className="mt-4 text-body-sm text-on-surface-variant text-center">
        A note (<span className="font-mono">trexure-note-v1-…</span>) is a bearer credential — only
        enter it here, over your own authenticated session.
      </p>
    </div>
  );
}
