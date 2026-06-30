import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  tryReconcile: vi.fn(async (): Promise<"SETTLED" | "WAITING" | "FAILED"> => "SETTLED"),
  logInfo: vi.fn(),
}));

vi.mock("../../lib/reconcile/matcher", () => ({ tryReconcile: h.tryReconcile }));
vi.mock("../../lib/log", () => ({ logger: { info: h.logInfo, error: vi.fn() } }));

import { processReconcile } from "./reconcile";

describe("processReconcile", () => {
  beforeEach(() => { h.tryReconcile.mockClear(); h.logInfo.mockClear(); });

  it("delegates to tryReconcile with the job's paymentId", async () => {
    await processReconcile({ data: { paymentId: "p1" } } as any);
    expect(h.tryReconcile).toHaveBeenCalledWith("p1");
  });

  it("logs the reconcile result", async () => {
    h.tryReconcile.mockResolvedValueOnce("WAITING");
    await processReconcile({ data: { paymentId: "p9" } } as any);
    expect(h.logInfo).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: "p9", result: "WAITING" }),
      expect.any(String),
    );
  });
});
