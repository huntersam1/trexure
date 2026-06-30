export function formatMoney(value: string, currency: string): string {
  return `${value} ${currency}`;
}

export function formatCorridor(from: string, to: string): string {
  return `${from}→${to}`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function truncateHash(hash: string, head = 6, tail = 4): string {
  if (hash.length <= head + tail + 1) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}
