"use client";

import { useState, type JSX } from "react";

import { apiPost, ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { CopyButton } from "@/components/ui/CopyButton";
import { Timeline } from "@/components/pool/Timeline";
import { PoolReceiptCard, type ReceiptLike } from "@/components/pool/PoolReceiptCard";
import type { PaymentDetail, DecryptedPayload } from "@/lib/ui/types";

const explorerTx = (h: string) => `https://stellar.expert/explorer/testnet/tx/${h}`;
const short = (s: string) => (s.length > 16 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s);
const errText = (e: unknown) => (e instanceof ApiError ? e.detail ?? e.message : "Something went wrong");

function Card({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="bg-surface border border-outline-variant rounded-xl p-6 flex flex-col gap-4">
      <h2 className="flex items-center gap-2 font-geist text-title-md font-bold text-on-surface">
        <Icon name={icon} className="text-[20px] text-primary" />
        {title}
      </h2>
      {children}
    </div>
  );
}

export function PoolPaymentDetail({
  payment,
  initialReceipt,
  csrfToken,
}: {
  payment: PaymentDetail;
  initialReceipt: ReceiptLike | null;
  csrfToken: string;
}): JSX.Element {
  const [decrypted, setDecrypted] = useState<DecryptedPayload | null>(null);
  const [decryptMsg, setDecryptMsg] = useState<string | null>(null);
  const [decrypting, setDecrypting] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfErr, setPdfErr] = useState<string | null>(null);

  async function onDecrypt() {
    setDecrypting(true);
    setDecryptMsg(null);
    try {
      const res = await apiPost<{ payload: DecryptedPayload }>(`/api/payments/${payment.id}/decrypt`, {}, csrfToken);
      setDecrypted(res.payload);
    } catch (e) {
      setDecryptMsg(e instanceof ApiError && e.status === 409 ? "No shielded payload to reveal." : errText(e));
    } finally {
      setDecrypting(false);
    }
  }

  async function onExportPdf() {
    setPdfBusy(true);
    setPdfErr(null);
    try {
      const { url } = await apiPost<{ url: string }>(`/api/payments/${payment.id}/receipt/pdf`, {}, csrfToken);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      setPdfErr(errText(e));
    } finally {
      setPdfBusy(false);
    }
  }

  const rowCls = "flex items-center justify-between gap-4 py-2 border-b border-outline-variant last:border-0 text-body-sm";

  return (
    <div className="grid gap-stack-lg lg:grid-cols-2">
      <Card title="Lifecycle" icon="timeline">
        <Timeline status={payment.status} />
        <div className="pt-2">
          <div className={rowCls}>
            <span className="text-on-surface-variant">Amount</span>
            <span className="font-mono text-on-surface">
              {payment.sourceAmount} {payment.sourceAsset} → {payment.targetCurrency}
            </span>
          </div>
          <div className={rowCls}>
            <span className="text-on-surface-variant">Intent</span>
            <span className="font-mono text-on-surface">{short(payment.intentId)}</span>
          </div>
        </div>
      </Card>

      <Card title="Legs" icon="account_tree">
        {payment.legs.length === 0 && <p className="text-body-sm text-on-surface-variant">No legs yet.</p>}
        {payment.legs.map((l) => (
          <div key={l.legType} className="rounded-lg border border-outline-variant bg-surface-container-low p-3 flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-body-sm">
              <span className="font-medium text-on-surface">{l.legType === "ONCHAIN" ? "On-chain" : "Fiat (bank)"}</span>
              <span className="text-label-mono uppercase tracking-widest text-on-surface-variant">{l.status}</span>
            </div>
            {l.txHash && (
              <a href={explorerTx(l.txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-primary hover:underline text-body-sm font-medium">
                <Icon name="open_in_new" className="text-[16px]" />
                {short(l.txHash)}
              </a>
            )}
            {l.bankRef && <span className="text-body-sm text-on-surface-variant">Bank ref: {l.bankRef}</span>}
            {l.amount && <span className="text-body-sm text-on-surface-variant">{l.amount} {l.currency}</span>}
          </div>
        ))}
      </Card>

      <Card title="Selective disclosure" icon="visibility">
        <p className="text-body-sm text-on-surface-variant">
          Reveal the shielded receiver/payout details for this disbursement under the tenant view key.
        </p>
        <div>
          <Button variant="primary" onClick={onDecrypt} disabled={decrypting || Boolean(decrypted)}>
            <Icon name={decrypting ? "progress_activity" : "lock_open"} className={decrypting ? "text-[20px] animate-spin" : "text-[20px]"} />
            {decrypted ? "Revealed" : decrypting ? "Decrypting…" : "Decrypt with view key"}
          </Button>
        </div>
        {decryptMsg && <p className="text-body-sm text-on-surface-variant">{decryptMsg}</p>}
        {decrypted && (
          <div className="rounded-lg border border-outline-variant bg-surface-container-low p-3">
            <div className={rowCls}><span className="text-on-surface-variant">Sender</span><span className="text-on-surface">{decrypted.sender}</span></div>
            <div className={rowCls}><span className="text-on-surface-variant">Recipient</span><span className="text-on-surface">{decrypted.recipient}</span></div>
            <div className={rowCls}><span className="text-on-surface-variant">Asset</span><span className="text-on-surface">{decrypted.asset}</span></div>
            <div className={rowCls}><span className="text-on-surface-variant">Amount</span><span className="font-mono text-on-surface">{decrypted.amount}</span></div>
          </div>
        )}
      </Card>

      <Card title="Receipt" icon="receipt_long">
        {initialReceipt ? (
          <>
            <PoolReceiptCard receipt={initialReceipt} />
            <div className="flex items-center gap-3 flex-wrap">
              <Button variant="secondary" onClick={onExportPdf} disabled={pdfBusy}>
                <Icon name={pdfBusy ? "progress_activity" : "picture_as_pdf"} className={pdfBusy ? "text-[20px] animate-spin" : "text-[20px]"} />
                {pdfBusy ? "Preparing…" : "Export PDF"}
              </Button>
              <CopyButton text={JSON.stringify(initialReceipt, null, 2)} label="Copy JSON" />
            </div>
            {pdfErr && <p className="text-body-sm text-error">{pdfErr}</p>}
          </>
        ) : (
          <p className="text-body-sm text-on-surface-variant">
            No receipt yet — it is generated when the claim settles.
          </p>
        )}
      </Card>
    </div>
  );
}
