import Link from "next/link";
import { requireSession } from "../../../lib/auth/session";
import { getSettingsView } from "../../../lib/settings/load";
import { ViewKeyForm } from "./_components/view-key-form";
import { AnchorConfigForm } from "./_components/anchor-config-form";
import { RotateSecretButton } from "./_components/rotate-secret-button";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireSession();
  const view = await getSettingsView(user.tenantId);

  return (
    <main className="p-margin-desktop max-w-4xl mx-auto space-y-stack-lg">
      <div className="flex items-center justify-between">
        <h1 className="font-geist text-headline-lg text-on-surface">Settings</h1>
        <Link
          href="/settings/api-keys"
          className="bg-surface border border-primary/20 text-primary rounded-lg font-bold px-6 py-2.5 hover:bg-primary hover:text-on-primary active:scale-95 transition-all"
        >
          Manage API Keys
        </Link>
      </div>

      <ViewKeyForm hasViewKey={view.hasViewKey} fingerprint={view.viewKeyFingerprint} />

      <AnchorConfigForm provider={view.anchor?.provider ?? null} />

      <section className="bg-surface border border-outline-variant rounded-xl p-8 shadow-xl shadow-black/5">
        <h2 className="font-geist text-headline-md text-on-surface mb-1">Webhook Secret Rotation</h2>
        <p className="text-body-sm text-on-surface-variant">
          Generate a fresh HMAC secret for inbound fiat callbacks. The new value is shown once.
        </p>
        <RotateSecretButton disabled={!view.anchor} />
      </section>
    </main>
  );
}
