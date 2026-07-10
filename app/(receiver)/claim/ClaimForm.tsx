"use client";

import { useState, type JSX } from "react";

import { apiPost, ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

const NOTE_PREFIX = "trexure-note-v1-";

type Method = "wallet" | "bank";
type ClaimReceipt = {
  amounts: { destination: { currency: string; value: string } };
};
type ClaimResult = {
  method: Method;
  txHash: string;
  explorerUrl: string;
  paymentId?: string;
  receipt?: ClaimReceipt;
};

const inputCls =
  "w-full rounded-lg bg-surface-container-low border border-outline-variant px-3.5 py-2.5 text-body-md text-on-surface placeholder:text-on-surface-variant/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
const labelCls = "text-label-mono uppercase tracking-widest text-on-surface-variant/70";

export function ClaimForm({
  csrfToken,
  initialNote = "",
}: {
  csrfToken: string;
  initialNote?: string;
}): JSX.Element {
  const [note, setNote] = useState(initialNote);
  const [method, setMethod] = useState<Method>("wallet");
  const [address, setAddress] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");

  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ClaimResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Light client-side gate; the server does the authoritative validation.
  const noteOk = note.trim().startsWith(NOTE_PREFIX) && note.trim().length > NOTE_PREFIX.length + 100;
  const walletOk = /^G[A-Z2-7]{55}$/.test(address.trim());
  const bankOk = bankCode.trim() && accountName.trim() && accountNumber.trim().length >= 4;
  const canSubmit = !pending && noteOk && (method === "wallet" ? walletOk : Boolean(bankOk));

  async function onSubmit() {
    setPending(true);
    setError(null);
    setInfo(null);
    setResult(null);
    try {
      const payout =
        method === "wallet"
          ? { method: "wallet" as const, address: address.trim() }
          : {
              method: "bank" as const,
              bankCode: bankCode.trim(),
              accountName: accountName.trim(),
              accountNumber: accountNumber.trim(),
            };
      setResult(await apiPost<ClaimResult>("/api/claim", { note: note.trim(), payout }, csrfToken));
    } catch (e) {
      // 501 = the payout path exists but its execution lands in P4/P5. Surface it
      // as an informational notice rather than a hard error.
      if (e instanceof ApiError && e.status === 501) {
        setInfo(e.detail ?? "This claim path is coming soon.");
      } else {
        setError(e instanceof ApiError ? e.detail ?? e.message : "Something went wrong");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="bg-surface border border-outline-variant rounded-xl p-6 shadow-xl shadow-black/5 flex flex-col gap-5 max-w-xl">
      <label className="flex flex-col gap-1.5">
        <span className={labelCls}>Your note</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="trexure-note-v1-…"
          className={`${inputCls} font-mono resize-none`}
        />
        {note.trim() && !noteOk && (
          <span className="text-body-sm text-error">That doesn&apos;t look like a valid trexure note.</span>
        )}
      </label>

      <div className="flex flex-col gap-2">
        <span className={labelCls}>Pay me to</span>
        <div className="flex rounded-lg border border-outline-variant p-1 text-body-sm">
          <button
            type="button"
            onClick={() => setMethod("wallet")}
            className={`flex-1 rounded-md py-1.5 font-medium inline-flex items-center justify-center gap-1.5 ${method === "wallet" ? "bg-primary text-on-primary" : "text-on-surface-variant"}`}
          >
            <Icon name="account_balance_wallet" className="text-[18px]" />
            Crypto wallet
          </button>
          <button
            type="button"
            onClick={() => setMethod("bank")}
            className={`flex-1 rounded-md py-1.5 font-medium inline-flex items-center justify-center gap-1.5 ${method === "bank" ? "bg-primary text-on-primary" : "text-on-surface-variant"}`}
          >
            <Icon name="account_balance" className="text-[18px]" />
            PH bank account
          </button>
        </div>
      </div>

      {method === "wallet" ? (
        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>Stellar address (G…)</span>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="G…"
            className={`${inputCls} font-mono`}
          />
          {address.trim() && !walletOk && (
            <span className="text-body-sm text-error">Enter a valid Stellar public key (G…, 56 chars).</span>
          )}
        </label>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={labelCls}>Bank code</span>
            <input value={bankCode} onChange={(e) => setBankCode(e.target.value)} placeholder="e.g. BDO" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelCls}>Account name</span>
            <input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Full name" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelCls}>Account number</span>
            <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="Account number" className={`${inputCls} font-mono`} />
          </label>
        </div>
      )}

      <Button variant="primary" onClick={onSubmit} disabled={!canSubmit}>
        <Icon name={pending ? "progress_activity" : "redeem"} className={pending ? "text-[20px] animate-spin" : "text-[20px]"} />
        {pending ? "Submitting…" : "Claim my payment"}
      </Button>

      {error && <p className="text-body-sm text-error">{error}</p>}
      {info && (
        <p className="flex items-start gap-2 text-body-sm text-on-surface-variant bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2">
          <Icon name="schedule" className="text-[18px] mt-0.5" />
          {info}
        </p>
      )}
      {result && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 flex flex-col gap-2">
          <p className="flex items-center gap-2 text-on-surface font-medium">
            <Icon name="check_circle" className="text-[20px] text-primary" />
            {result.receipt
              ? `Paid ${result.receipt.amounts.destination.value} ${result.receipt.amounts.destination.currency} — settled`
              : "Claim settled"}
          </p>
          <div className="flex items-center gap-4 flex-wrap text-body-sm">
            <a href={result.explorerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-primary hover:underline font-medium">
              <Icon name="open_in_new" className="text-[16px]" />
              View withdraw transaction
            </a>
            {result.receipt && <span className="text-on-surface-variant">On-chain receipt issued.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
