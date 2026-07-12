"use client";

import type { JSX } from "react";

// Last-resort boundary: replaces the ROOT layout when it (or anything above a
// segment boundary) throws, so it must render its own <html>/<body> and cannot
// rely on globals.css/tokens or next/font being present. Inline styles only.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): JSX.Element {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#F7F9FB",
          color: "#1A1025",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <main
          role="alert"
          style={{
            background: "#ffffff",
            border: "1px solid #E5E7EB",
            borderRadius: 12,
            padding: 32,
            maxWidth: 420,
            boxShadow: "0 20px 25px -5px rgba(0,0,0,0.05)",
          }}
        >
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Something went wrong</h1>
          <p style={{ color: "#5B4A70", lineHeight: 1.5 }}>
            Trexure hit an unexpected error and couldn&apos;t render this page. Your data is safe.
          </p>
          {error.digest && (
            <p style={{ fontFamily: "monospace", fontSize: 12, color: "#5B4A70" }}>
              Error ref: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              background: "#8E44AD",
              color: "#ffffff",
              border: 0,
              borderRadius: 8,
              padding: "10px 24px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
