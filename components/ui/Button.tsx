import type { ButtonHTMLAttributes, JSX } from "react";

type Variant = "primary" | "accent" | "secondary" | "neutral" | "ghost";

const BASE = "rounded-lg font-bold px-6 py-2.5 transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 inline-flex items-center justify-center gap-2";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-on-primary shadow-lg shadow-primary/10 hover:opacity-90",
  accent: "bg-accent text-on-primary shadow-lg shadow-accent/20 hover:opacity-90",
  secondary: "bg-surface border border-primary/20 text-primary hover:bg-primary hover:text-on-primary",
  neutral: "bg-surface border border-outline text-on-surface hover:bg-surface-container-low",
  ghost: "text-on-surface-variant hover:text-primary px-3",
};

const DISABLED = "bg-surface-container-highest text-on-surface-variant opacity-50 cursor-not-allowed";

export function Button({
  variant = "primary",
  disabled = false,
  className = "",
  children,
  ...rest
}: { variant?: Variant; disabled?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return (
    <button
      {...rest}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : rest.tabIndex}
      className={`${BASE} ${disabled ? DISABLED : VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
