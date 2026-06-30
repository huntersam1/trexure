import { cookies } from "next/headers";
import { requireSession } from "../../../../lib/auth/session";
import { forTenant } from "../../../../lib/db";
import { CSRF_COOKIE_NAME } from "../../../../lib/auth/csrf";
import { CreateApiKeyPanel } from "./_components/create-api-key-panel";
import { RevokeKeyButton } from "./_components/revoke-key-button";

export const dynamic = "force-dynamic";

export async function listTenantApiKeys(tenantId: string) {
  const rows = await forTenant(tenantId).apiKey.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, lastUsedAt: true, revokedAt: true, createdAt: true },
  });
  return rows.map((k) => ({
    id: k.id,
    name: k.name,
    lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
    revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
    createdAt: k.createdAt.toISOString(),
  }));
}

const th = "text-left text-label-mono uppercase tracking-widest font-bold text-on-surface-variant px-4 py-3";
const td = "px-4 py-3 text-body-sm text-on-surface";

export default async function ApiKeysPage() {
  const user = await requireSession();
  const keys = await listTenantApiKeys(user.tenantId);
  // The double-submit CSRF cookie is HttpOnly, so the client can't read it; the
  // server reads it here and hands the token to the islands to echo as x-csrf-token.
  const csrfToken = (await cookies()).get(CSRF_COOKIE_NAME)?.value ?? "";

  return (
    <main className="p-margin-desktop max-w-4xl mx-auto space-y-stack-lg">
      <h1 className="font-geist text-headline-lg text-on-surface">API Keys</h1>

      <CreateApiKeyPanel csrfToken={csrfToken} />

      <section className="bg-surface border border-outline-variant rounded-xl shadow-xl shadow-black/5 overflow-hidden">
        <table className="w-full border-collapse">
          <thead className="bg-surface-container-low border-b border-outline-variant">
            <tr>
              <th className={th}>Name</th>
              <th className={th}>Last Used</th>
              <th className={th}>Created</th>
              <th className={th}>Status</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 && (
              <tr><td className={`${td} text-on-surface-variant`} colSpan={5}>No API keys yet.</td></tr>
            )}
            {keys.map((k) => (
              <tr key={k.id} className="border-b border-outline-variant last:border-0">
                <td className={`${td} font-mono`}>{k.name}</td>
                <td className={`${td} font-mono text-on-surface-variant`}>{k.lastUsedAt ?? "—"}</td>
                <td className={`${td} font-mono text-on-surface-variant`}>{k.createdAt}</td>
                <td className={td}>
                  {k.revokedAt ? (
                    <span className="bg-surface-container-highest text-on-surface-variant rounded text-[10px] font-bold uppercase tracking-widest px-2 py-1">Revoked</span>
                  ) : (
                    <span className="bg-primary/20 text-primary rounded text-[10px] font-bold uppercase tracking-widest px-2 py-1">Active</span>
                  )}
                </td>
                <td className={`${td} text-right`}>{!k.revokedAt && <RevokeKeyButton id={k.id} csrfToken={csrfToken} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
