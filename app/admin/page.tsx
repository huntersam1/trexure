import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { requireSession } from "../../lib/auth/session";
import { CSRF_COOKIE_NAME } from "../../lib/auth/csrf";
import { listTenantsWithCounts, listWebhookEvents, recentAuditLogs } from "../../lib/admin/queries";
import { CreateUserForm } from "./_components/create-user-form";
import { HealthPanel } from "./_components/health-panel";

export const dynamic = "force-dynamic";

const card = "bg-surface border border-outline-variant rounded-xl p-8 shadow-xl shadow-black/5";
const th = "text-left text-label-mono uppercase tracking-widest font-bold text-on-surface-variant px-4 py-3";
const td = "px-4 py-3 text-body-sm text-on-surface";

export default async function AdminPage() {
  // Platform-operator console (#143 C1). Non-operators get a 404 rather than a
  // 403 so the console's existence isn't disclosed to tenant admins.
  const user = await requireSession();
  if (!user.isPlatformAdmin) notFound();
  const [tenants, webhooks, audits] = await Promise.all([
    listTenantsWithCounts(),
    listWebhookEvents(10),
    recentAuditLogs(20),
  ]);
  const csrfToken = (await cookies()).get(CSRF_COOKIE_NAME)?.value ?? "";

  const verifiedCount = webhooks.filter((w) => w.verified).length;

  return (
    <main className="p-margin-desktop max-w-4xl mx-auto space-y-stack-lg">
      <div className="flex items-center justify-between">
        <h1 className="font-geist text-headline-lg text-on-surface">Admin Console</h1>
        <Link href="/admin/webhooks" className="bg-surface border border-primary/20 text-primary rounded-lg font-bold px-6 py-2.5 hover:bg-primary hover:text-on-primary active:scale-95 transition-all">
          Webhook Event Log
        </Link>
      </div>

      <section className={card}>
        <h2 className="font-geist text-headline-md text-on-surface mb-6">Tenants &amp; Users</h2>
        <table className="w-full border-collapse">
          <thead className="bg-surface-container-low border-b border-outline-variant">
            <tr><th className={th}>Tenant</th><th className={th}>Users</th><th className={th}>Created</th></tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} className="border-b border-outline-variant last:border-0">
                <td className={`${td} font-mono`}>{t.name}</td>
                <td className={`${td} font-mono`}>{t.userCount}</td>
                <td className={`${td} font-mono text-on-surface-variant`}>{t.createdAt.toISOString().slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={card}>
        <h2 className="font-geist text-headline-md text-on-surface mb-6">Create User</h2>
        <CreateUserForm tenants={tenants.map((t) => ({ id: t.id, name: t.name }))} csrfToken={csrfToken} />
      </section>

      <div className="grid grid-cols-2 gap-gutter">
        <section className={card}>
          <h2 className="font-geist text-headline-md text-on-surface mb-6">Worker &amp; Job Health</h2>
          <HealthPanel />
        </section>

        <section className={card}>
          <h2 className="font-geist text-headline-md text-on-surface mb-2">Webhook Summary</h2>
          <p className="text-body-sm text-on-surface-variant mb-4">
            <span className="font-mono text-on-surface">{verifiedCount}</span> verified of{" "}
            <span className="font-mono text-on-surface">{webhooks.length}</span> recent events.
          </p>
          <ul className="space-y-2">
            {webhooks.map((w) => (
              <li key={w.id} className="flex items-center justify-between text-body-sm">
                <span className="font-mono text-on-surface-variant">{w.provider}/{w.externalId.slice(0, 12)}</span>
                <span className={`rounded text-[10px] font-bold uppercase tracking-widest px-2 py-1 ${w.verified ? "bg-primary/20 text-primary" : "bg-error-container text-error"}`}>
                  {w.verified ? "Verified" : "Unverified"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className={card}>
        <h2 className="font-geist text-headline-md text-on-surface mb-1">Audit Log</h2>
        <p className="text-body-sm text-on-surface-variant mb-6">
          Sensitive actions: logins, view-key decrypts, key creation, and admin operations.
        </p>
        <table className="w-full border-collapse">
          <thead className="bg-surface-container-low border-b border-outline-variant">
            <tr><th className={th}>When</th><th className={th}>Action</th><th className={th}>Actor</th><th className={th}>Tenant</th><th className={th}>Target</th></tr>
          </thead>
          <tbody>
            {audits.map((a) => (
              <tr key={a.id} className="border-b border-outline-variant last:border-0">
                <td className={`${td} font-mono text-on-surface-variant`}>{a.createdAt.toISOString()}</td>
                <td className={`${td} font-mono text-primary`}>{a.action}</td>
                <td className={`${td} font-mono text-on-surface-variant`}>{a.userId ?? "—"}</td>
                <td className={`${td} font-mono text-on-surface-variant`}>{a.tenantId ?? "—"}</td>
                <td className={`${td} font-mono text-on-surface-variant`}>{a.target ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
