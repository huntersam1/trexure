import "server-only";
import type { JSX } from "react";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";

import { requireSession } from "@/lib/auth/session";
import { CSRF_COOKIE_NAME } from "@/lib/auth/csrf";
import { env } from "@/lib/env";
import { Icon } from "@/components/ui/Icon";
import { BatchRail } from "./BatchRail";

export const dynamic = "force-dynamic";

export default async function PoolBatchPage(): Promise<JSX.Element> {
  // Gated identically to the single-transfer rail (#65): off ⇒ 404.
  if (!env.ENABLE_POOL_RAIL) notFound();
  await requireSession();
  const csrfToken = (await cookies()).get(CSRF_COOKIE_NAME)?.value ?? "";

  return (
    <div className="flex flex-col gap-stack-lg">
      <div>
        <Link
          href="/pool"
          className="inline-flex items-center gap-1 text-body-sm text-on-surface-variant hover:text-primary"
        >
          <Icon name="arrow_back" className="text-[16px]" />
          Private on-chain transfer
        </Link>
        <h1 className="mt-2 font-geist text-headline-lg text-on-surface">Batch send</h1>
        <p className="mt-1 text-body-md text-on-surface-variant max-w-prose">
          Pay a whole roster of freelancers at once. Each row becomes a private pool deposit and a{" "}
          <span className="text-on-surface font-medium">claimable note</span> — hand each receiver
          their note and they claim their pay to a wallet or bank in the receiver interface.
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-outline-variant bg-surface-container-low px-4 py-3 text-body-sm text-on-surface-variant">
        <Icon name="info" className="text-[18px] text-on-surface-variant mt-0.5" />
        <p>
          Demo-grade: valueless testnet XLM, server-signed. Deposits run sequentially on testnet, so
          a large batch takes a moment. A note is a bearer credential — deliver it privately.
        </p>
      </div>

      <BatchRail csrfToken={csrfToken} />
    </div>
  );
}
