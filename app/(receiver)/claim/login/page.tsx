import type { JSX } from "react";
import { redirect, notFound } from "next/navigation";

import { env } from "@/lib/env";
import { getReceiver } from "@/lib/receiver/session";
import { ReceiverAuthForm } from "./ReceiverAuthForm";

export const dynamic = "force-dynamic";

export default async function ReceiverLoginPage(): Promise<JSX.Element> {
  if (!env.ENABLE_POOL_RAIL) notFound();
  const receiver = await getReceiver();
  if (receiver) redirect("/claim");

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="bg-surface border border-outline-variant rounded-xl p-8 shadow-xl shadow-black/5">
        <div className="mb-6">
          <h1 className="font-geist text-headline-sm text-on-surface">Receiver access</h1>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            Log in or create a receiver account to claim a payment you were sent.
          </p>
        </div>
        <ReceiverAuthForm />
      </div>
      <p className="mt-4 text-body-sm text-on-surface-variant text-center">
        A note (<span className="font-mono">trexure-note-v1-…</span>) is a bearer credential — only
        enter it here, over your own authenticated session.
      </p>
    </div>
  );
}
