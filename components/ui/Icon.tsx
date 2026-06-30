import type { JSX } from "react";

export function Icon({
  name,
  fill = false,
  className = "",
}: {
  name: string;
  fill?: boolean;
  className?: string;
}): JSX.Element {
  return (
    <span
      aria-hidden="true"
      data-fill={fill ? "1" : "0"}
      className={`material-symbols-outlined select-none ${className}`}
    >
      {name}
    </span>
  );
}
