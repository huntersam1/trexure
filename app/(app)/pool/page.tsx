import "server-only";
import type { JSX } from "react";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { requireSession } from "@/lib/auth/session";
import { CSRF_COOKIE_NAME } from "@/lib/auth/csrf";
import { env } from "@/lib/env";
import { Icon } from "@/components/ui/Icon";
import { PoolRail } from "./PoolRail";

export const dynamic = "force-dynamic";

export default async function PoolPage(): Promise<JSX.Element> {
  // When the rail is off, it does not exist — 404, nothing else changes (#65).
  if (!env.ENABLE_POOL_RAIL) notFound();
  await requireSession();
  const csrfToken = (await cookies()).get(CSRF_COOKIE_NAME)?.value ?? "";

  return (
    <div className="flex flex-col gap-stack-lg">
      <div>
        <h1 className="font-geist text-headline-lg text-on-surface">Private on-chain transfer</h1>
        <p className="mt-1 text-body-md text-on-surface-variant max-w-prose">
          A real shielded pool on Soroban testnet: deposit XLM for a secret note, then claim it to any
          address. The deposit and the withdrawal are <span className="text-on-surface font-medium">unlinkable</span> —
          the connection is hidden in zero knowledge.
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-outline-variant bg-surface-container-low px-4 py-3 text-body-sm text-on-surface-variant">
        <Icon name="info" className="text-[18px] text-on-surface-variant mt-0.5" />
        <p>
          Demo-grade: valueless testnet XLM, server-signed (real-wallet signing is out of scope), a
          demo trusted setup, and a 16-leaf anonymity set. Not for real value.
        </p>
      </div>

      <PoolRail csrfToken={csrfToken} />
    </div>
  );
}
