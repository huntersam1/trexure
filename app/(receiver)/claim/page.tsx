import type { JSX } from "react";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { env } from "@/lib/env";
import { requireReceiver } from "@/lib/receiver/session";
import { countUnreadForReceiver } from "@/lib/receiver/notifications";
import { CSRF_COOKIE_NAME } from "@/lib/auth/csrf";
import { Icon } from "@/components/ui/Icon";
import { ClaimForm } from "./ClaimForm";
import { receiverLogoutAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ClaimPage(): Promise<JSX.Element> {
  if (!env.ENABLE_POOL_RAIL) notFound();
  const receiver = await requireReceiver();
  const csrfToken = (await cookies()).get(CSRF_COOKIE_NAME)?.value ?? "";
  const unread = await countUnreadForReceiver(receiver.id);

  return (
    <div className="flex flex-col gap-stack-lg">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-geist text-headline-lg text-on-surface">Claim a payment</h1>
          <p className="mt-1 text-body-md text-on-surface-variant max-w-prose">
            Paste the note you were sent and choose where to be paid — a Stellar wallet or a
            Philippine bank account.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={"/claim/inbox" as Route}
            className="relative inline-flex items-center gap-1.5 rounded-lg border border-outline-variant px-3 py-2 text-body-sm text-on-surface-variant hover:text-on-surface"
          >
            <Icon name="inbox" className="text-[18px]" />
            Inbox
            {unread > 0 && (
              <span className="ml-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-on-primary">
                {unread}
              </span>
            )}
          </Link>
          <form action={receiverLogoutAction}>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant px-3 py-2 text-body-sm text-on-surface-variant hover:text-on-surface"
            >
              <Icon name="logout" className="text-[18px]" />
              {receiver.email}
            </button>
          </form>
        </div>
      </div>

      <ClaimForm csrfToken={csrfToken} />
    </div>
  );
}
