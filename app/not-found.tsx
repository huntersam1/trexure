import type { JSX } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

export const metadata = { title: "Not found — Trexure" };

// Root not-found: renders for unmatched URLs AND for notFound() calls that
// bubble up from role/feature gates inside the route groups.
export default function NotFound(): JSX.Element {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-6">
      <section className="bg-surface border border-outline-variant rounded-xl shadow-xl shadow-black/5 p-8 max-w-md flex flex-col items-start gap-4">
        <span className="inline-flex items-center gap-2 text-on-surface-variant">
          <Icon name="search_off" className="text-[20px]" />
          <span className="text-label-mono font-mono uppercase tracking-widest">404</span>
        </span>
        <h1 className="text-headline-md font-geist text-on-surface">Page not found</h1>
        <p className="text-body-md text-on-surface-variant">
          This page doesn&apos;t exist or your account doesn&apos;t have access to it.
        </p>
        <Link
          href="/"
          className="bg-primary text-on-primary rounded-lg font-bold px-6 py-2.5 shadow-lg shadow-primary/10 hover:opacity-90 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Back to dashboard
        </Link>
      </section>
    </main>
  );
}
