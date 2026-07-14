import { describe, it, expect, vi, beforeEach } from "vitest";

const { requireAdmin, saveYieldConfig, recordAudit } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  saveYieldConfig: vi.fn(),
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../auth/session", () => ({ requireAdmin }));
vi.mock("./config", () => ({ saveYieldConfig }));
vi.mock("../audit/log", () => ({ recordAudit }));

import { saveYieldConfigAction } from "./actions";
import { AppError } from "../http/problem";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("saveYieldConfigAction", () => {
  beforeEach(() => {
    requireAdmin.mockReset().mockResolvedValue({ id: "u_1", tenantId: "t_A", role: "ADMIN" });
    saveYieldConfig.mockReset().mockResolvedValue({
      enabled: true, yieldAsset: "YLDS", minIdleBuffer: "100", sweepThreshold: "50", feeBps: "25",
    });
    recordAudit.mockClear();
  });

  it("saves via the SESSION tenant (never the form) and audits", async () => {
    const res = await saveYieldConfigAction(null, fd({
      enabled: "on", minIdleBuffer: "100", sweepThreshold: "50", feeBps: "25", tenantId: "t_B",
    }));
    expect(res.ok).toBe(true);
    // t_A from the session, not the smuggled t_B.
    expect(saveYieldConfig).toHaveBeenCalledWith("t_A", {
      enabled: true, minIdleBuffer: "100", sweepThreshold: "50", feeBps: "25",
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "yield.config.update", tenantId: "t_A", userId: "u_1" }),
    );
  });

  it("treats an absent checkbox as disabled", async () => {
    await saveYieldConfigAction(null, fd({ minIdleBuffer: "0", sweepThreshold: "0", feeBps: "0" }));
    expect(saveYieldConfig).toHaveBeenCalledWith("t_A", expect.objectContaining({ enabled: false }));
  });

  it("surfaces a validation AppError as a clean error result (no throw)", async () => {
    saveYieldConfig.mockRejectedValueOnce(new AppError(422, "Invalid yield config", "feeBps must be between 0 and 10000"));
    const res = await saveYieldConfigAction(null, fd({ enabled: "on", feeBps: "99999" }));
    expect(res).toEqual({ ok: false, error: "feeBps must be between 0 and 10000" });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("rejects a non-admin (requireAdmin throws) without saving", async () => {
    requireAdmin.mockRejectedValueOnce(new AppError(403, "Forbidden", "Admin only"));
    const res = await saveYieldConfigAction(null, fd({ enabled: "on" }));
    expect(res.ok).toBe(false);
    expect(saveYieldConfig).not.toHaveBeenCalled();
  });
});
