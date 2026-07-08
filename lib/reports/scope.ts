/**
 * Period (and future counterparty) scoping helpers shared by every report
 * (R1–R5). Pure — no `server-only` — so callers can build a range in a route,
 * a server component, or a test without pulling in the DB layer.
 *
 * A report period is an inclusive calendar range keyed on `Payment.createdAt`
 * (the period a payment belongs to). `to` is expanded to the end of its day so
 * a "2026-07-01 → 2026-07-31" range captures everything created on the 31st.
 */

export type DateRange = { from: Date; to: Date };

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function endOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

/** The current calendar month [1st 00:00:00, last day 23:59:59.999] in UTC. */
export function currentMonthRange(now: Date): DateRange {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { from, to };
}

/**
 * Parse `from`/`to` query params (YYYY-MM-DD). Missing or invalid inputs fall
 * back to the current month. `to` is normalized to end-of-day (inclusive) and
 * a reversed range is swapped so the result is always `from <= to`.
 */
export function parseDateRange(
  fromStr: string | null | undefined,
  toStr: string | null | undefined,
  now: Date = new Date(),
): DateRange {
  const month = currentMonthRange(now);

  const fromParsed = fromStr ? new Date(`${fromStr}T00:00:00.000Z`) : null;
  const toParsed = toStr ? new Date(`${toStr}T00:00:00.000Z`) : null;

  let from = fromParsed && !Number.isNaN(fromParsed.getTime()) ? startOfDay(fromParsed) : month.from;
  let to = toParsed && !Number.isNaN(toParsed.getTime()) ? endOfDay(toParsed) : month.to;

  if (from.getTime() > to.getTime()) {
    [from, to] = [startOfDay(to), endOfDay(from)];
  }
  return { from, to };
}

/** Format a Date as YYYY-MM-DD (UTC) for input[type=date] values / filenames. */
export function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** A Prisma `where` fragment scoping a query to the range on `createdAt`. */
export function createdAtWithin(range: DateRange): { createdAt: { gte: Date; lte: Date } } {
  return { createdAt: { gte: range.from, lte: range.to } };
}

/** Human label for a range, e.g. "2026-07-01 to 2026-07-31". */
export function rangeLabel(range: DateRange): string {
  return `${toDateInput(range.from)} to ${toDateInput(range.to)}`;
}

export { DAY_MS };
