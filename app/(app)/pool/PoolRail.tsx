"use client";

import { useState, type JSX } from "react";

import { apiPost, ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { CopyButton } from "@/components/ui/CopyButton";

type DepositResult = { note: string; amount: number; txHash: string; explorerUrl: string };
type WithdrawResult = { txHash: string; explorerUrl: string };
type DemoResult = {
  amount: number;
  note: string;
  recipient: string;
  deposit: { txHash: string; explorerUrl: string };
  withdraw: { txHash: string; explorerUrl: string };
};

const errText = (e: unknown) => (e instanceof ApiError ? e.detail ?? e.message : "Something went wrong");
const short = (s: string) => `${s.slice(0, 8)}…${s.slice(-6)}`;

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

function Card({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="bg-surface border border-outline-variant rounded-xl p-6 shadow-xl shadow-black/5 flex flex-col gap-4">{children}</div>;
}

export function PoolRail({ csrfToken }: { csrfToken: string }): JSX.Element {
  // Deposit
  const [amount, setAmount] = useState("10");
  const [depositing, setDepositing] = useState(false);
  const [deposit, setDeposit] = useState<DepositResult | null>(null);
  const [depositErr, setDepositErr] = useState<string | null>(null);

  // Claim
  const [note, setNote] = useState("");
  const [recipient, setRecipient] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [withdraw, setWithdraw] = useState<WithdrawResult | null>(null);
  const [claimErr, setClaimErr] = useState<string | null>(null);

  // One-click demo
  const [running, setRunning] = useState(false);
  const [demo, setDemo] = useState<DemoResult | null>(null);
  const [demoErr, setDemoErr] = useState<string | null>(null);

  async function onDeposit() {
    setDepositing(true);
    setDepositErr(null);
    setDeposit(null);
    try {
      setDeposit(await apiPost<DepositResult>("/api/pool/deposit", { amount: Number(amount) }, csrfToken));
    } catch (e) {
      setDepositErr(errText(e));
    } finally {
      setDepositing(false);
    }
  }

  async function onClaim() {
    setClaiming(true);
    setClaimErr(null);
    setWithdraw(null);
    try {
      setWithdraw(await apiPost<WithdrawResult>("/api/pool/withdraw", { note: note.trim(), recipient: recipient.trim() }, csrfToken));
    } catch (e) {
      setClaimErr(errText(e));
    } finally {
      setClaiming(false);
    }
  }

  async function onDemo() {
    setRunning(true);
    setDemoErr(null);
    setDemo(null);
    try {
      setDemo(await apiPost<DemoResult>("/api/pool/demo", { amount: 10 }, csrfToken));
    } catch (e) {
      setDemoErr(errText(e));
    } finally {
      setRunning(false);
    }
  }

  const inputCls =
    "w-full rounded-lg bg-surface-container-low border border-outline-variant px-3.5 py-2.5 text-body-md text-on-surface placeholder:text-on-surface-variant/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

  return (
    <div className="grid gap-stack-lg lg:grid-cols-2">
      {/* One-click demo — spans both columns, top of the pitch */}
      <div className="lg:col-span-2">
        <Card>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <Icon name="bolt" className="text-[26px] text-accent" />
              <div>
                <h2 className="font-geist text-title-lg font-bold text-on-surface">One-click demo</h2>
                <p className="text-body-sm text-on-surface-variant">
                  Deposit 10 XLM, then claim it to a brand-new address using only the note — unlinkable on-chain.
                </p>
              </div>
            </div>
            <Button variant="accent" onClick={onDemo} disabled={running}>
              <Icon name={running ? "progress_activity" : "play_arrow"} className={running ? "text-[20px] animate-spin" : "text-[20px]"} />
              {running ? "Running on testnet…" : "Run demo"}
            </Button>
          </div>
          {demoErr && <p className="text-body-sm text-error">{demoErr}</p>}
          {demo && (
            <div className="rounded-lg bg-surface-container-low border border-outline-variant p-4 flex flex-col gap-2 text-body-sm">
              <div className="flex items-center gap-2 text-on-surface">
                <Icon name="arrow_downward" className="text-[18px] text-on-surface-variant" />
                <span className="font-medium">Deposited {demo.amount} XLM</span>
                <TxLink url={demo.deposit.explorerUrl} hash={demo.deposit.txHash} label="deposit" />
              </div>
              <div className="flex items-center gap-2 text-on-surface">
                <Icon name="arrow_upward" className="text-[18px] text-on-surface-variant" />
                <span className="font-medium">Paid {short(demo.recipient)}</span>
                <TxLink url={demo.withdraw.explorerUrl} hash={demo.withdraw.txHash} label="withdraw" />
              </div>
              <p className="text-on-surface-variant flex items-center gap-1.5">
                <Icon name="lock" className="text-[16px] text-primary" />
                The withdraw envelope never references the deposit — the link is hidden in zero knowledge.
              </p>
            </div>
          )}
        </Card>
      </div>

      {/* Deposit */}
      <Card>
        <div className="flex items-center gap-3">
          <Icon name="shield_lock" className="text-[24px] text-primary" />
          <h2 className="font-geist text-title-lg font-bold text-on-surface">Shield into the pool</h2>
        </div>
        <p className="text-body-sm text-on-surface-variant">
          Deposit XLM and receive a secret note. The recipient is chosen later, at claim time.
        </p>
        <label className="flex flex-col gap-1.5">
          <span className="text-label-mono uppercase tracking-widest text-on-surface-variant/70">Amount (XLM)</span>
          <input type="number" min="0" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
        </label>
        <Button variant="primary" onClick={onDeposit} disabled={depositing || !(Number(amount) > 0)}>
          <Icon name={depositing ? "progress_activity" : "add"} className={depositing ? "text-[20px] animate-spin" : "text-[20px]"} />
          {depositing ? "Depositing on testnet…" : "Shield into pool"}
        </Button>
        {depositErr && <p className="text-body-sm text-error">{depositErr}</p>}
        {deposit && (
          <div className="rounded-lg border border-accent/40 bg-accent/5 p-4 flex flex-col gap-3">
            <p className="flex items-center gap-2 text-body-sm font-bold text-on-surface">
              <Icon name="warning" className="text-[18px] text-accent" />
              Save this note — it is the ONLY way to claim these funds.
            </p>
            <code className="block break-all rounded bg-surface-container-low border border-outline-variant p-3 text-label-mono text-on-surface">
              {deposit.note}
            </code>
            <div className="flex items-center gap-3 flex-wrap">
              <CopyButton text={deposit.note} label="Copy note" />
              <TxLink url={deposit.explorerUrl} hash={deposit.txHash} label="deposit tx" />
            </div>
          </div>
        )}
      </Card>

      {/* Claim */}
      <Card>
        <div className="flex items-center gap-3">
          <Icon name="redeem" className="text-[24px] text-primary" />
          <h2 className="font-geist text-title-lg font-bold text-on-surface">Claim a note</h2>
        </div>
        <p className="text-body-sm text-on-surface-variant">
          Paste a note and a destination address. The pool pays out with a ZK proof — unlinkable to the deposit.
        </p>
        <label className="flex flex-col gap-1.5">
          <span className="text-label-mono uppercase tracking-widest text-on-surface-variant/70">Note</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="trexure-note-v1-…" className={`${inputCls} font-mono resize-none`} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-label-mono uppercase tracking-widest text-on-surface-variant/70">Recipient (G…)</span>
          <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="G…" className={`${inputCls} font-mono`} />
        </label>
        <Button variant="primary" onClick={onClaim} disabled={claiming || !note.trim() || !recipient.trim()}>
          <Icon name={claiming ? "progress_activity" : "send"} className={claiming ? "text-[20px] animate-spin" : "text-[20px]"} />
          {claiming ? "Proving + withdrawing…" : "Claim to address"}
        </Button>
        {claimErr && <p className="text-body-sm text-error">{claimErr}</p>}
        {withdraw && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 flex items-center gap-3">
            <Icon name="check_circle" className="text-[20px] text-primary" />
            <TxLink url={withdraw.explorerUrl} hash={withdraw.txHash} label="withdraw tx" />
          </div>
        )}
      </Card>
    </div>
  );
}
