import type { JSX } from "react";
import type { Metadata } from "next";

import { resolveDisclosureLink } from "@/lib/reports/disclosure-link";
import { verifyAttestation } from "@/lib/reports/attestation";
import { VerifyOnChain } from "./VerifyOnChain";

export const dynamic = "force-dynamic";
// A tokenized disclosure must never be indexed or followed by crawlers.
export const metadata: Metadata = {
  title: "Verify payment · Trexure",
  robots: { index: false, follow: false, nocache: true },
};

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5 py-2 border-t border-outline-variant/60">
      <span className="text-label-mono uppercase tracking-widest text-on-surface-variant/70">{label}</span>
      <span className="font-mono text-body-sm text-on-surface break-all">{value || "—"}</span>
    </div>
  );
}

function InvalidState(): JSX.Element {
  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-surface">
      <div className="max-w-md text-center">
        <h1 className="font-geist text-headline-md text-on-surface">This link is no longer valid</h1>
        <p className="mt-2 text-body-md text-on-surface-variant">
          The verification link has expired, been revoked, or does not exist. Ask the sender to issue a new one.
        </p>
      </div>
    </main>
  );
}

export default async function VerifyPage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<JSX.Element> {
  const { token } = await params;
  const res = await resolveDisclosureLink(token);
  if (res.status !== "ok") return <InvalidState />;

  const att = res.attestation;
  const signatureValid = verifyAttestation(att);

  return (
    <main className="min-h-screen bg-surface p-6 flex justify-center">
      <div className="w-full max-w-2xl flex flex-col gap-stack-lg py-8">
        <header>
          <p className="text-label-mono uppercase tracking-widest text-primary">Trexure · Verifiable disclosure</p>
          <h1 className="mt-2 font-geist text-headline-lg text-on-surface">Proof of payment</h1>
          <p className="mt-1 text-body-md text-on-surface-variant max-w-prose">
            A single settled payment, disclosed by the paying company. Nothing else in their ledger is revealed. You
            can confirm the on-chain proof yourself below.
          </p>
        </header>

        <section className="bg-surface border border-outline-variant rounded-xl p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-geist text-headline-sm text-on-surface">Payment</h2>
            <span
              className={`rounded-full px-2.5 py-1 text-label-mono font-bold ${
                signatureValid ? "bg-primary/15 text-primary" : "bg-error/15 text-error"
              }`}
            >
              {signatureValid ? "issuer signature valid" : "signature mismatch"}
            </span>
          </div>
          <div className="mt-2">
            <Row label="Counterparty" value={att.counterparty} />
            <Row label="Amount paid" value={`${att.source.value} ${att.source.currency}`} />
            <Row label="Received" value={`${att.destination.value} ${att.destination.currency}`} />
            <Row label="Corridor" value={att.corridor} />
            {att.fxRate ? <Row label="FX rate" value={att.fxRate} /> : null}
            {att.bankRef ? <Row label="Bank reference" value={att.bankRef} /> : null}
            <Row label="Settled" value={att.settledAt} />
            <Row label="Receipt ID" value={att.receiptId} />
          </div>
        </section>

        <section className="bg-surface border border-outline-variant rounded-xl p-5">
          <h2 className="font-geist text-headline-sm text-on-surface">On-chain proof</h2>
          <div className="mt-2">
            <Row label="Transaction" value={att.txHash} />
            <Row label="Proof hash (ZK commitment)" value={att.proofHash} />
            {att.ledger ? <Row label="Ledger" value={att.ledger} /> : null}
          </div>
          {att.txUrl ? (
            <a
              href={att.txUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="mt-3 inline-flex items-center gap-1 text-body-sm text-primary hover:underline"
            >
              Independently confirm on stellar.expert ↗
            </a>
          ) : null}
          <div className="mt-4">
            <VerifyOnChain token={token} />
          </div>
        </section>

        <p className="text-label-mono text-on-surface-variant/70">{att.signature.note}</p>
      </div>
    </main>
  );
}
