import type { JSX } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { env } from "@/lib/env";
import { requireReceiver } from "@/lib/receiver/session";
import { listNotificationsForReceiver } from "@/lib/receiver/notifications";
import { Icon } from "@/components/ui/Icon";
import { NotificationItem } from "@/components/receiver/NotificationItem";
import { markAllReadAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function InboxPage(): Promise<JSX.Element> {
  if (!env.ENABLE_POOL_RAIL) notFound();
  const receiver = await requireReceiver();
  const notifications = await listNotificationsForReceiver(receiver.id);
  const unread = notifications.filter((n) => !n.read).length;

  return (
    <div className="flex flex-col gap-stack-lg">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-geist text-headline-lg text-on-surface">Your payments</h1>
          <p className="mt-1 text-body-md text-on-surface-variant max-w-prose">
            Incoming payments from Trexure workspaces that recognized your email. Open one to
            claim it — you&apos;ll still need the private note you were sent.
          </p>
        </div>
        {unread > 0 && (
          <form action={markAllReadAction}>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant px-3 py-2 text-body-sm text-on-surface-variant hover:text-on-surface"
            >
              <Icon name="mark_email_read" className="text-[18px]" />
              Mark all read
            </button>
          </form>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="rounded-xl border border-dashed border-outline-variant px-4 py-10 text-center text-body-md text-on-surface-variant">
          No payments yet. When a workspace sends you one, it&apos;ll show up here.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {notifications.map((n) => (
            <NotificationItem key={n.id} n={n} />
          ))}
        </ul>
      )}

      <div>
        <Link href="/claim" className="text-body-sm text-primary font-bold hover:underline">
          ← Back to claim
        </Link>
      </div>
    </div>
  );
}
