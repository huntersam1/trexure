"use client";

import { useState, type JSX } from "react";

import { apiPost, ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { CopyButton } from "@/components/ui/CopyButton";

type Row = { amount: string; ref: string; email: string };

type ReceiverResult =
  | {
      ok: true;
      ref: string;
      email: string | null;
      amount: string;
      paymentId: string;
      intentId: string;
      note: string;
      commitment: string;
      claimUrl: string;
      poolContractId: string;
      deposit: { txHash: string; explorerUrl: string };
      notifiedInApp: boolean;
      emailedClaim: boolean;
    }
  | { ok: false; ref: string; email: string | null; amount: string; error: string };

type BatchResult = {
  batchId: string;
  requested: number;
  count: number;
  totalSourceAmount: string;
  poolContractId: string;
  claimUrl: string;
  results: ReceiverResult[];
};

const errText = (e: unknown) => (e instanceof ApiError ? e.detail ?? e.message : "Something went wrong");
const short = (s: string) => `${s.slice(0, 8)}…${s.slice(-6)}`;
const emptyRow = (): Row => ({ amount: "10", ref: "", email: "" });

/** The single copy-paste block a payer hands to one receiver. */
function claimDetails(r: Extract<ReceiverResult, { ok: true }>): string {
  return [
    `Trexure — claim your private payment`,
    `Amount: ${r.amount} XLM`,
    `Claim at: ${r.claimUrl}`,
    `Pool contract: ${r.poolContractId}`,
    ``,
    `Your note (bearer credential — anyone holding it can claim; keep it secret):`,
    r.note,
  ].join("\n");
}

function Card({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="bg-surface border border-outline-variant rounded-xl p-6 shadow-xl shadow-black/5 flex flex-col gap-4">
      {children}
    </div>
  );
}

function TxLink({ url, hash, label }: { url: string; hash: string; label: string }): JSX.Element {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-primary hover:underline font-medium"
    >
      <Icon name="open_in_new" className="text-[16px]" />
      {label} {short(hash)}
    </a>
  );
}

export function BatchRail({ csrfToken }: { csrfToken: string }): JSX.Element {
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const inputCls =
    "w-full rounded-lg bg-surface-container-low border border-outline-variant px-3.5 py-2.5 text-body-md text-on-surface placeholder:text-on-surface-variant/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((rs) => [...rs, emptyRow()]);
  }
  function removeRow(i: number) {
    setRows((rs) => (rs.length === 1 ? rs : rs.filter((_, idx) => idx !== i)));
  }

  const validRows = rows.filter((r) => r.ref.trim() && Number(r.amount) > 0);
  const canSend = validRows.length > 0 && !sending;

  async function onSend() {
    setSending(true);
    setErr(null);
    setResult(null);
    try {
      const receivers = validRows.map((r) => ({
        amount: r.amount.trim(),
        ref: r.ref.trim(),
        ...(r.email.trim() ? { email: r.email.trim() } : {}),
      }));
      setResult(await apiPost<BatchResult>("/api/pool/batch", { receivers }, csrfToken));
    } catch (e) {
      setErr(errText(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-stack-lg">
      {/* Compose the batch */}
      <Card>
        <div className="flex items-center gap-3">
          <Icon name="group" className="text-[24px] text-primary" />
          <h2 className="font-geist text-title-lg font-bold text-on-surface">Receivers</h2>
        </div>

        <div className="flex flex-col gap-3">
          <div className="hidden sm:grid grid-cols-[1fr_1.4fr_1.4fr_auto] gap-3 text-label-mono uppercase tracking-widest text-on-surface-variant/70">
            <span>Amount (XLM)</span>
            <span>Label / reference</span>
            <span>Email (optional)</span>
            <span className="w-9" />
          </div>
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1.4fr_1.4fr_auto] gap-3">
              <input
                type="number"
                min="0"
                step="1"
                value={row.amount}
                onChange={(e) => setRow(i, { amount: e.target.value })}
                placeholder="Amount"
                className={inputCls}
                aria-label={`Amount for receiver ${i + 1}`}
              />
              <input
                value={row.ref}
                onChange={(e) => setRow(i, { ref: e.target.value })}
                placeholder="e.g. Alice — invoice #42"
                className={inputCls}
                aria-label={`Label for receiver ${i + 1}`}
              />
              <input
                type="email"
                value={row.email}
                onChange={(e) => setRow(i, { email: e.target.value })}
                placeholder="alice@example.com"
                className={inputCls}
                aria-label={`Email for receiver ${i + 1}`}
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                disabled={rows.length === 1}
                aria-label={`Remove receiver ${i + 1}`}
                className="inline-flex items-center justify-center rounded-lg border border-outline-variant text-on-surface-variant hover:text-error hover:border-error/40 disabled:opacity-40 disabled:cursor-not-allowed h-[42px] w-9"
              >
                <Icon name="close" className="text-[18px]" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <Button variant="ghost" onClick={addRow}>
            <Icon name="add" className="text-[20px]" />
            Add receiver
          </Button>
          <Button variant="primary" onClick={onSend} disabled={!canSend}>
            <Icon
              name={sending ? "progress_activity" : "send"}
              className={sending ? "text-[20px] animate-spin" : "text-[20px]"}
            />
            {sending
              ? "Sending on testnet…"
              : `Send batch (${validRows.length} receiver${validRows.length === 1 ? "" : "s"})`}
          </Button>
        </div>
        {err && <p className="text-body-sm text-error">{err}</p>}
      </Card>

      {/* Results */}
      {result && (
        <Card>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <Icon name="receipt_long" className="text-[24px] text-primary" />
              <h2 className="font-geist text-title-lg font-bold text-on-surface">
                Batch sent — {result.count}/{result.requested} succeeded
              </h2>
            </div>
            <a
              href={`/pool/batches/${result.batchId}`}
              className="inline-flex items-center gap-1.5 text-body-sm text-primary hover:underline font-medium"
            >
              <Icon name="open_in_new" className="text-[16px]" />
              {result.totalSourceAmount} XLM disbursed · view batch
            </a>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-accent/40 bg-accent/5 px-4 py-3 text-body-sm text-on-surface">
            <Icon name="warning" className="text-[18px] text-accent mt-0.5" />
            <p>
              <span className="font-bold">Each note below is a bearer credential.</span> Anyone who
              holds it can claim the funds — deliver it to the right receiver privately. Trexure does
              not store the notes; this is the only time they are shown.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            {result.results.map((r, i) => (
              <div
                key={i}
                className={`rounded-lg border p-4 flex flex-col gap-3 ${
                  r.ok ? "border-outline-variant bg-surface-container-low" : "border-error/40 bg-error/5"
                }`}
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 text-on-surface">
                    <Icon
                      name={r.ok ? "check_circle" : "error"}
                      className={`text-[18px] ${r.ok ? "text-primary" : "text-error"}`}
                    />
                    <span className="font-medium">{r.ref}</span>
                    <span className="text-on-surface-variant">· {r.amount} XLM</span>
                    {r.email && <span className="text-on-surface-variant">· {r.email}</span>}
                    {r.ok && r.notifiedInApp && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-outline-variant px-2 py-0.5 text-[11px] text-on-surface-variant">
                        <Icon name="notifications" className="text-[13px]" />
                        Notified in app
                      </span>
                    )}
                    {r.ok && r.emailedClaim && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-outline-variant px-2 py-0.5 text-[11px] text-on-surface-variant">
                        <Icon name="mail" className="text-[13px]" />
                        Emailed
                      </span>
                    )}
                  </div>
                  {r.ok && <TxLink url={r.deposit.explorerUrl} hash={r.deposit.txHash} label="deposit" />}
                </div>

                {r.ok ? (
                  <>
                    <code className="block break-all rounded bg-surface border border-outline-variant p-3 text-label-mono text-on-surface">
                      {r.note}
                    </code>
                    <div className="flex items-center gap-3 flex-wrap text-body-sm text-on-surface-variant">
                      <CopyButton text={r.note} label="Copy note" />
                      <CopyButton text={claimDetails(r)} label="Copy claim details" />
                      <span>
                        Claim at <span className="text-on-surface">{r.claimUrl}</span>
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="text-body-sm text-error">Failed: {r.error}</p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
