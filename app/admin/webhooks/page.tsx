import Link from "next/link";
import { requireAdmin } from "../../../lib/auth/session";
import { listWebhookEvents } from "../../../lib/admin/queries";

export const dynamic = "force-dynamic";

const th = "text-left text-label-mono uppercase tracking-widest font-bold text-on-surface-variant px-4 py-3";
const td = "px-4 py-3 text-body-sm";

export default async function AdminWebhooksPage() {
  await requireAdmin();
  const events = await listWebhookEvents(200);

  return (
    <main className="p-margin-desktop max-w-4xl mx-auto space-y-stack-lg">
      <div className="flex items-center justify-between">
        <h1 className="font-geist text-headline-lg text-on-surface">Webhook Events</h1>
        <Link href="/admin" className="text-on-surface-variant hover:text-primary text-body-sm">← Back to Admin</Link>
      </div>

      <section className="bg-surface border border-outline-variant rounded-xl shadow-xl shadow-black/5 overflow-hidden">
        <table className="w-full border-collapse">
          <thead className="bg-surface-container-low border-b border-outline-variant">
            <tr>
              <th className={th}>Received</th>
              <th className={th}>Provider</th>
              <th className={th}>External ID</th>
              <th className={th}>Verification</th>
              <th className={th}>Idempotency</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr><td className={`${td} text-on-surface-variant`} colSpan={5}>No webhook events recorded.</td></tr>
            )}
            {events.map((e) => {
              const processed = Boolean(e.processedAt);
              return (
                <tr key={e.id} className="border-b border-outline-variant last:border-0">
                  <td className={`${td} font-mono text-on-surface-variant`}>{e.createdAt.toISOString()}</td>
                  <td className={`${td} font-mono text-on-surface`}>{e.provider}</td>
                  <td className={`${td} font-mono text-on-surface break-all`}>{e.externalId}</td>
                  <td className={td}>
                    <span className={`rounded text-[10px] font-bold uppercase tracking-widest px-2 py-1 ${e.verified ? "bg-primary/20 text-primary" : "bg-error-container text-error"}`}>
                      {e.verified ? "Verified" : "Unverified"}
                    </span>
                  </td>
                  <td className={td}>
                    <span className={`rounded text-[10px] font-bold uppercase tracking-widest px-2 py-1 ${processed ? "bg-accent/20 text-accent" : "bg-surface-container-highest text-on-surface-variant"}`}>
                      {processed ? "Processed" : "Pending"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </main>
  );
}
