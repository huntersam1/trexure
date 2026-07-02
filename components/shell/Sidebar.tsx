"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { JSX } from "react";
import type { Route } from "next";
import { Icon } from "@/components/ui/Icon";

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
}: {
  username: string;
  role: "ADMIN" | "MEMBER";
  newPaymentsEnabled: boolean;
}): JSX.Element {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <aside className="w-64 shrink-0 bg-surface border-r border-outline-variant flex flex-col">
      <div className="px-6 py-6 border-b border-outline-variant">
        <span className="font-geist text-headline-md font-[800] tracking-tight text-on-surface">Trexure</span>
        <p className="mt-1 text-label-mono uppercase tracking-widest font-bold text-primary/70">Treasury Ops</p>
      </div>
      <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
        {NAV.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href as Route}
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
        {role === "ADMIN" && (
          <Link
            href={"/admin" as Route}
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
      <div className="px-4 py-4 border-t border-outline-variant">
        <p className="text-body-sm font-medium text-on-surface truncate">{username}</p>
        <p className="text-label-mono uppercase tracking-widest font-bold text-on-surface-variant/60">{role}</p>
      </div>
    </aside>
  );
}
