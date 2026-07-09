import type { JSX } from "react";

/**
 * Brand mark + optional wordmark (#115). Single source of truth for the Trexure
 * logo so login/signup, the tenant shell, and the receiver claim surface all
 * render it identically. Presentational only (no hooks) so it works in both
 * server components (auth pages, receiver layout) and client components (Sidebar,
 * AppShell). The mark is the square logo drawn dark-on-light and inverted to sit
 * on the dark `on-surface` chip, matching the original Sidebar treatment.
 */
export function Logo({
  wordmark = true,
  className = "",
}: {
  wordmark?: boolean;
  className?: string;
}): JSX.Element {
  return (
    <span className={`flex items-center gap-3 ${className}`}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-on-surface p-1.5 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.jpg"
          alt={wordmark ? "" : "Trexure"}
          className="h-full w-full object-contain brightness-0 invert"
        />
      </span>
      {wordmark && (
        <span className="font-geist text-headline-md font-[800] tracking-tight text-on-surface">
          Trexure
        </span>
      )}
    </span>
  );
}
