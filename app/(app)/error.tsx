"use client";

import type { JSX } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";

// Segment error boundary for the authed app. Catches server/render errors from
// any (app) page (incl. AppError thrown by requireSession-style helpers) while
// keeping the shell (sidebar/topbar) mounted.
export default function AppSegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): JSX.Element {
  return (
    <section
      role="alert"
      className="bg-surface border border-outline-variant rounded-xl shadow-xl shadow-black/5 p-8 flex flex-col items-start gap-4 max-w-xl"
    >
      <span className="inline-flex items-center gap-2 text-error">
        <Icon name="error" className="text-[20px]" />
        <h1 className="text-headline-md font-geist text-on-surface">Something went wrong</h1>
      </span>
      <p className="text-body-md text-on-surface-variant">
        This page hit an unexpected error. Your data is safe — the operation may simply not have
        completed. Try again, or head back to the dashboard.
      </p>
      {error.digest && (
        <p className="text-label-mono font-mono text-on-surface-variant">
          Error ref: {error.digest}
        </p>
      )}
      <span className="inline-flex items-center gap-3">
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
        <Link
          href="/"
          className="text-primary font-bold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
        >
          Back to dashboard
        </Link>
      </span>
    </section>
  );
}
