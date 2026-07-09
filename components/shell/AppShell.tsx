"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import type { JSX, ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Logo } from "@/components/ui/Logo";
import { Icon } from "@/components/ui/Icon";

/**
 * Responsive tenant shell (#115). Desktop (md+) keeps the original static
 * Sidebar. Below md the Sidebar collapses into a hamburger-triggered off-canvas
 * drawer with a backdrop, and a compact top bar carries the logo + menu button.
 * The drawer auto-closes on route change and when a nav link is followed.
 */
export function AppShell({
  username,
  role,
  newPaymentsEnabled,
  poolRailEnabled,
  onLogout,
  children,
}: {
  username: string;
  role: "ADMIN" | "MEMBER";
  newPaymentsEnabled: boolean;
  poolRailEnabled: boolean;
  onLogout: () => void | Promise<void>;
  children: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer whenever the route changes — defence-in-depth alongside the
  // per-link onNavigate, and it also covers programmatic navigation. Adjusting
  // state during render (React's "storing info from previous renders" pattern)
  // avoids an effect and the cascading-render it would cause.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setOpen(false);
  }

  const nav = { username, role, newPaymentsEnabled, poolRailEnabled, onLogout };

  return (
    <div className="h-screen overflow-hidden flex bg-background text-on-surface">
      {/* Desktop sidebar — `contents` lets the aside be a direct flex child. */}
      <div className="hidden md:contents">
        <Sidebar {...nav} />
      </div>

      {/* Mobile off-canvas drawer + backdrop. */}
      <div
        data-testid="mobile-drawer"
        aria-hidden={!open}
        className={`md:hidden fixed inset-0 z-40 ${open ? "" : "pointer-events-none"}`}
      >
        <button
          type="button"
          aria-label="Close menu"
          tabIndex={open ? 0 : -1}
          onClick={() => setOpen(false)}
          className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${
            open ? "opacity-100" : "opacity-0"
          }`}
        />
        <div
          className={`absolute inset-y-0 left-0 transition-transform duration-200 ease-out ${
            open ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <Sidebar {...nav} onNavigate={() => setOpen(false)} onClose={() => setOpen(false)} />
        </div>
      </div>

      {/* Content column. */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="md:hidden flex items-center gap-3 border-b border-outline-variant bg-surface px-4 py-3">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-expanded={open}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <Icon name="menu" className="text-[24px]" />
          </button>
          <Logo />
        </header>
        <main className="flex-1 overflow-y-auto trx-scroll">
          <div className="mx-auto w-full max-w-[1280px] p-margin-desktop">{children}</div>
        </main>
      </div>
    </div>
  );
}
