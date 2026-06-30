"use client";

import { useState, type JSX } from "react";
import { Icon } from "@/components/ui/Icon";

export function CopyButton({ text, label = "Copy JSON" }: { text: string; label?: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-2 rounded-lg bg-surface border border-outline text-on-surface px-4 py-2 text-body-sm transition-all active:scale-95 hover:bg-surface-container-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <Icon name={copied ? "check" : "content_copy"} className="text-[16px]" />
      {copied ? "Copied" : label}
    </button>
  );
}
