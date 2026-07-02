import { Prisma } from "./generated/prisma/client";

const D = Prisma.Decimal;

/**
 * Demo FX quotes — the single source of truth for corridor rates. The Mock
 * Anchor's webhook fxRate, the payment's quoted targetAmount, and the payout
 * instruction all derive from here so the receipt's economics stay coherent
 * (destination = source x rate; slippage 0 for the demo corridor).
 * A real anchor integration replaces this with its live quote API.
 */
export const DEMO_FX_RATES: Record<string, string> = {
  "USD:PHP": "56.70",
};

/** Quoted FX rate for a corridor as a decimal string, or null if unquoted. */
export function quoteFxRate(corridorFrom: string, corridorTo: string): string | null {
  if (corridorFrom === corridorTo) return "1.00";
  return DEMO_FX_RATES[`${corridorFrom}:${corridorTo}`] ?? null;
}

/** Quoted destination-currency amount for a corridor, or null if unquoted. */
export function quoteTargetAmount(
  sourceAmount: string | { toString(): string },
  corridorFrom: string,
  corridorTo: string,
): string | null {
  const rate = quoteFxRate(corridorFrom, corridorTo);
  if (!rate) return null;
  return new D(sourceAmount.toString()).mul(rate).toFixed(2);
}
