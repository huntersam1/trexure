export type NodeState = "future" | "active" | "complete";

export const STEPPER_NODES = [
  { key: "ledger", label: "Ledger" },
  { key: "enclave", label: "Enclave" },
  { key: "recon", label: "Recon" },
  { key: "receipt", label: "Receipt" },
] as const;

export function nodeState(index: number, current: number): NodeState {
  if (index < current) return "complete";
  if (index === current) return "active";
  return "future";
}

export function fillPercent(current: number, total: number): number {
  const max = total - 1;
  const clamped = Math.max(0, Math.min(current, max));
  return (clamped / max) * 100;
}
