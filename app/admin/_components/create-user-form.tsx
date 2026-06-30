"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const inputCls =
  "w-full bg-surface border border-outline rounded-lg px-4 py-2.5 text-body-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none";
const primaryBtn =
  "bg-primary text-on-primary rounded-lg font-bold px-6 py-2.5 shadow-lg shadow-primary/10 hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed";
const labelCls = "block text-label-mono uppercase tracking-widest font-bold text-primary/70 mb-2";

export function CreateUserForm({ tenants, csrfToken }: { tenants: Array<{ id: string; name: string }>; csrfToken: string }) {
  const router = useRouter();
  const [form, setForm] = useState({ username: "", password: "", role: "MEMBER", tenantId: tenants[0]?.id ?? "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify(form),
      });
      if (res.status === 201) {
        setMsg({ ok: true, text: "User created." });
        setForm({ username: "", password: "", role: "MEMBER", tenantId: tenants[0]?.id ?? "" });
        router.refresh();
      } else {
        const p = await res.json().catch(() => ({}));
        setMsg({ ok: false, text: p.detail ?? p.title ?? "Could not create user." });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" autoComplete="off">
      <div className="grid grid-cols-2 gap-gutter">
        <div>
          <label htmlFor="username" className={labelCls}>Username</label>
          <input id="username" className={inputCls} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" />
        </div>
        <div>
          <label htmlFor="password" className={labelCls}>Password</label>
          <input id="password" type="password" className={inputCls} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
        </div>
        <div>
          <label htmlFor="role" className={labelCls}>Role</label>
          <select id="role" className={inputCls} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="MEMBER">MEMBER</option>
            <option value="ADMIN">ADMIN</option>
          </select>
        </div>
        <div>
          <label htmlFor="tenantId" className={labelCls}>Tenant</label>
          <select id="tenantId" className={inputCls} value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })}>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>
      {msg && <p className={`text-body-sm ${msg.ok ? "text-primary" : "text-error"}`}>{msg.text}</p>}
      <button type="submit" disabled={busy} className={primaryBtn}>{busy ? "Creating…" : "Create User"}</button>
    </form>
  );
}
