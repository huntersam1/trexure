import type { JSX, ReactNode } from "react";

import { Icon } from "@/components/ui/Icon";

export const dynamic = "force-dynamic";

/**
 * Receiver (freelancer) shell (P3, #85) — deliberately NOT the tenant `(app)`
 * sidebar. A receiver only ever sees their claim surface. This layout wraps both
 * the login/register page (no session) and the claim page (session-gated in the
 * page itself), so it must not require a receiver session here.
 */
export default function ReceiverLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="min-h-screen bg-background text-on-surface flex flex-col">
      <header className="border-b border-outline-variant">
        <div className="mx-auto w-full max-w-3xl px-4 py-4 flex items-center gap-2">
          <Icon name="account_balance_wallet" className="text-[22px] text-primary" />
          <span className="font-geist text-title-lg font-[800] tracking-tight">Trexure</span>
          <span className="text-label-mono uppercase tracking-widest font-bold text-primary/70">
            Claim your pay
          </span>
        </div>
      </header>
      <main className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-4 py-8">{children}</div>
      </main>
    </div>
  );
}
