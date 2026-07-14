"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { JSX } from "react";
import type { Route } from "next";
import { Icon } from "@/components/ui/Icon";
import { Logo } from "@/components/ui/Logo";

const NAV = [
  { href: "/", label: "Dashboard", icon: "dashboard" },
  { href: "/payments", label: "Payments", icon: "swap_horiz" },
  { href: "/payments/new", label: "New Payment", icon: "add_circle" },
  { href: "/settings", label: "Settings", icon: "settings" },
] as const;

export function Sidebar({
  username,
  role,
  newPaymentsEnabled,
  poolRailEnabled = false,
  yieldEnabled = false,
  onNavigate,
  onClose,
  onLogout,
}: {
  username: string;
  role: "ADMIN" | "MEMBER";
  newPaymentsEnabled: boolean;
  poolRailEnabled?: boolean;
  yieldEnabled?: boolean;
  /** Called when a nav link is followed — used to close the mobile drawer. */
  onNavigate?: () => void;
  /** When provided, renders a close (X) button in the header (mobile drawer). */
  onClose?: () => void;
  /** Server action wired to the footer logout form. Renders logout when set. */
  onLogout?: () => void | Promise<void>;
}): JSX.Element {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <aside className="w-64 h-full shrink-0 bg-surface border-r border-outline-variant flex flex-col">
      <div className="px-6 py-6 border-b border-outline-variant">
        <div className="flex items-center justify-between gap-3">
          <Logo />
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close menu"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface md:hidden"
            >
              <Icon name="close" className="text-[22px]" />
            </button>
          )}
        </div>
        <p className="mt-1.5 text-label-mono uppercase tracking-widest font-bold text-primary/70">Treasury Ops</p>
      </div>
      <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
        {NAV.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href as Route}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-body-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                active
                  ? "bg-primary-container text-primary font-bold"
                  : "text-on-surface-variant hover:bg-surface-container-low"
              }`}
            >
              <Icon name={item.icon} className="text-[20px]" />
              {item.label}
              {item.href === "/payments/new" && !newPaymentsEnabled && (
                <span
                  title="Shielded transfer contract — in progress"
                  className="ml-auto rounded-full border border-outline-variant px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/70"
                >
                  soon
                </span>
              )}
            </Link>
          );
        })}
        {poolRailEnabled && (
          <Link
            href={"/pool" as Route}
            onClick={onNavigate}
            aria-current={pathname === "/pool" ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-body-sm transition-all ${
              pathname === "/pool"
                ? "bg-primary-container text-primary font-bold"
                : "text-on-surface-variant hover:bg-surface-container-low"
            }`}
          >
            <Icon name="shield_lock" className="text-[20px]" />
            Private Transfer
          </Link>
        )}
        {poolRailEnabled && (
          <Link
            href={"/pool/batches" as Route}
            onClick={onNavigate}
            aria-current={pathname.startsWith("/pool/batch") ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-body-sm transition-all ${
              pathname.startsWith("/pool/batch")
                ? "bg-primary-container text-primary font-bold"
                : "text-on-surface-variant hover:bg-surface-container-low"
            }`}
          >
            <Icon name="groups" className="text-[20px]" />
            Batch payments
          </Link>
        )}
        {role === "ADMIN" && yieldEnabled && (
          <Link
            href={"/yield" as Route}
            onClick={onNavigate}
            aria-current={isActive("/yield") ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-body-sm transition-all ${
              isActive("/yield")
                ? "bg-primary-container text-primary font-bold"
                : "text-on-surface-variant hover:bg-surface-container-low"
            }`}
          >
            <Icon name="savings" className="text-[20px]" />
            Treasury Yield
          </Link>
        )}
        {role === "ADMIN" && (
          <Link
            href={"/reports" as Route}
            onClick={onNavigate}
            aria-current={isActive("/reports") ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-body-sm transition-all ${
              isActive("/reports")
                ? "bg-primary-container text-primary font-bold"
                : "text-on-surface-variant hover:bg-surface-container-low"
            }`}
          >
            <Icon name="summarize" className="text-[20px]" />
            Reports
          </Link>
        )}
        {role === "ADMIN" && (
          <Link
            href={"/employees" as Route}
            onClick={onNavigate}
            aria-current={isActive("/employees") ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-body-sm transition-all ${
              isActive("/employees")
                ? "bg-primary-container text-primary font-bold"
                : "text-on-surface-variant hover:bg-surface-container-low"
            }`}
          >
            <Icon name="badge" className="text-[20px]" />
            Employees
          </Link>
        )}
        {role === "ADMIN" && (
          <Link
            href={"/admin" as Route}
            onClick={onNavigate}
            aria-current={isActive("/admin") ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-body-sm transition-all ${
              isActive("/admin")
                ? "bg-primary-container text-primary font-bold"
                : "text-on-surface-variant hover:bg-surface-container-low"
            }`}
          >
            <Icon name="shield_person" className="text-[20px]" />
            Admin
          </Link>
        )}
      </nav>
      <div className="px-4 py-4 border-t border-outline-variant flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-body-sm font-medium text-on-surface truncate">{username}</p>
          <p className="text-label-mono uppercase tracking-widest font-bold text-on-surface-variant/60">{role}</p>
        </div>
        {onLogout && (
          <form action={onLogout}>
            <button
              type="submit"
              aria-label="Log out"
              title="Log out"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Icon name="logout" className="text-[20px]" />
            </button>
          </form>
        )}
      </div>
    </aside>
  );
}
