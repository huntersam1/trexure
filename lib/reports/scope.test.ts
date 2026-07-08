import { describe, it, expect } from "vitest";
import { parseDateRange, currentMonthRange, toDateInput, rangeLabel } from "./scope";

const NOW = new Date("2026-07-08T12:34:00.000Z");

describe("currentMonthRange", () => {
  it("spans the first to the last day of the month (inclusive)", () => {
    const r = currentMonthRange(NOW);
    expect(r.from.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-07-31T23:59:59.999Z");
  });
});

describe("parseDateRange", () => {
  it("defaults to the current month when params are missing", () => {
    const r = parseDateRange(null, null, NOW);
    expect(toDateInput(r.from)).toBe("2026-07-01");
    expect(toDateInput(r.to)).toBe("2026-07-31");
  });

  it("parses explicit dates and expands `to` to end-of-day", () => {
    const r = parseDateRange("2026-06-01", "2026-06-15", NOW);
    expect(r.from.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-06-15T23:59:59.999Z");
  });

  it("swaps a reversed range so from <= to", () => {
    const r = parseDateRange("2026-06-20", "2026-06-01", NOW);
    expect(toDateInput(r.from)).toBe("2026-06-01");
    expect(toDateInput(r.to)).toBe("2026-06-20");
    expect(r.from.getTime()).toBeLessThan(r.to.getTime());
  });

  it("falls back to the month on invalid input", () => {
    const r = parseDateRange("not-a-date", "also-bad", NOW);
    expect(toDateInput(r.from)).toBe("2026-07-01");
    expect(toDateInput(r.to)).toBe("2026-07-31");
  });
});

describe("rangeLabel", () => {
  it("formats a readable range", () => {
    expect(rangeLabel(parseDateRange("2026-07-01", "2026-07-31", NOW))).toBe(
      "2026-07-01 to 2026-07-31",
    );
  });
});
