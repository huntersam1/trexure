"use client";

import { useState, type JSX } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

type RoleView = { id: string; title: string };
type ItemType = "BASE_SALARY" | "BONUS" | "ALLOWANCE" | "BENEFIT_NON_MONETARY";
type Cadence = "MONTHLY" | "ANNUAL" | "ONE_OFF";
type ItemRow = {
  type: ItemType;
  label: string;
  amount: string;
  currency: string;
  notionalValue: string;
  cadence: Cadence;
  convertible: boolean;
};

const ITEM_TYPES: { value: ItemType; label: string }[] = [
  { value: "BASE_SALARY", label: "Base salary" },
  { value: "BONUS", label: "Bonus" },
  { value: "ALLOWANCE", label: "Allowance" },
  { value: "BENEFIT_NON_MONETARY", label: "Non-monetary benefit" },
];

const blankItem = (type: ItemType = "ALLOWANCE"): ItemRow => ({
  type,
  label: "",
  amount: "",
  currency: "PHP",
  notionalValue: "",
  cadence: "MONTHLY",
  convertible: false,
});

const field = "rounded-lg border border-outline-variant bg-surface px-3 py-2 text-body-sm text-on-surface";

export function OnboardForm({ roles, csrfToken }: { roles: RoleView[]; csrfToken: string }): JSX.Element {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [startDate, setStartDate] = useState("");
  const [roleId, setRoleId] = useState("");
  const [items, setItems] = useState<ItemRow[]>([{ ...blankItem("BASE_SALARY"), label: "Base salary" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const setItem = (idx: number, patch: Partial<ItemRow>) =>
    setItems((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = {
        name,
        email,
        ...(startDate ? { startDate } : {}),
        ...(roleId ? { roleId } : {}),
        package: {
          items: items.map((i) => {
            const nonMonetary = i.type === "BENEFIT_NON_MONETARY";
            return {
              type: i.type,
              label: i.label,
              cadence: i.cadence,
              convertible: i.convertible,
              ...(nonMonetary ? { notionalValue: i.notionalValue } : { amount: i.amount, currency: i.currency }),
            };
          }),
        },
      };
      const res = await fetch("/api/hr/employees", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
        setError(body.detail ?? "Could not onboard the employee.");
        return;
      }
      const { employee } = (await res.json()) as { employee: { id: string } };
      router.push(`/employees/${employee.id}` as Route);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-stack-lg max-w-3xl">
      <div>
        <Link href={"/employees" as Route} className="inline-flex items-center gap-1 text-body-sm text-on-surface-variant hover:text-primary">
          <Icon name="arrow_back" className="text-[16px]" />
          Employees
        </Link>
        <h1 className="mt-2 font-geist text-headline-lg text-on-surface">Onboard employee</h1>
      </div>

      <section className="bg-surface border border-outline-variant rounded-xl p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-label-mono uppercase tracking-widest text-on-surface-variant/70">Name</span>
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-label-mono uppercase tracking-widest text-on-surface-variant/70">Email</span>
          <input className={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-label-mono uppercase tracking-widest text-on-surface-variant/70">Role</span>
          <select className={field} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">— none —</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-label-mono uppercase tracking-widest text-on-surface-variant/70">Start date</span>
          <input className={field} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
      </section>

      <section className="bg-surface border border-outline-variant rounded-xl p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-geist text-body-lg text-on-surface">Compensation package</h2>
          <button
            type="button"
            onClick={() => setItems((r) => [...r, blankItem()])}
            className="inline-flex items-center gap-1 text-body-sm text-primary hover:underline"
          >
            <Icon name="add" className="text-[16px]" /> Add item
          </button>
        </div>

        {items.map((it, idx) => {
          const nonMonetary = it.type === "BENEFIT_NON_MONETARY";
          return (
            <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end border-t border-outline-variant/50 pt-3">
              <label className="sm:col-span-3 flex flex-col gap-1">
                <span className="text-label-mono uppercase tracking-widest text-on-surface-variant/70">Type</span>
                <select className={field} value={it.type} onChange={(e) => setItem(idx, { type: e.target.value as ItemType })}>
                  {ITEM_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sm:col-span-4 flex flex-col gap-1">
                <span className="text-label-mono uppercase tracking-widest text-on-surface-variant/70">Label</span>
                <input className={field} value={it.label} onChange={(e) => setItem(idx, { label: e.target.value })} required />
              </label>
              {nonMonetary ? (
                <label className="sm:col-span-2 flex flex-col gap-1">
                  <span className="text-label-mono uppercase tracking-widest text-on-surface-variant/70">Notional</span>
                  <input className={field} value={it.notionalValue} onChange={(e) => setItem(idx, { notionalValue: e.target.value })} required />
                </label>
              ) : (
                <>
                  <label className="sm:col-span-1 flex flex-col gap-1">
                    <span className="text-label-mono uppercase tracking-widest text-on-surface-variant/70">Amt</span>
                    <input className={field} value={it.amount} onChange={(e) => setItem(idx, { amount: e.target.value })} required />
                  </label>
                  <label className="sm:col-span-1 flex flex-col gap-1">
                    <span className="text-label-mono uppercase tracking-widest text-on-surface-variant/70">Ccy</span>
                    <input className={field} value={it.currency} onChange={(e) => setItem(idx, { currency: e.target.value })} required />
                  </label>
                </>
              )}
              <label className="sm:col-span-1 flex items-center gap-1.5 pb-2">
                <input type="checkbox" checked={it.convertible} onChange={(e) => setItem(idx, { convertible: e.target.checked })} />
                <span className="text-label-mono uppercase tracking-widest text-on-surface-variant/70" title="Convertible to cash (#135)">Conv</span>
              </label>
              <div className="sm:col-span-1 flex justify-end pb-1">
                {items.length > 1 && (
                  <button type="button" onClick={() => setItems((r) => r.filter((_, i) => i !== idx))} aria-label="Remove item" className="text-on-surface-variant hover:text-error">
                    <Icon name="delete" className="text-[18px]" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </section>

      {error && <p className="text-body-sm text-error">{error}</p>}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="rounded-lg bg-primary px-5 py-2.5 text-body-sm font-medium text-on-primary disabled:opacity-60">
          {busy ? "Onboarding…" : "Onboard employee"}
        </button>
        <Link href={"/employees" as Route} className="text-body-sm text-on-surface-variant hover:text-on-surface">
          Cancel
        </Link>
      </div>
    </form>
  );
}
