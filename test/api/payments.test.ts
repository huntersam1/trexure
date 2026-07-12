import { describe, it, expect, vi, beforeEach } from "vitest";

const requireSession = vi.fn();
const assertCsrf = vi.fn();
const createPayment = vi.fn();
const listPayments = vi.fn();
const idemStore = new Map<string, string>();

const envMock = { ENABLE_NEW_PAYMENTS: true };
vi.mock("../../lib/env", () => ({ env: envMock }));
vi.mock("../../lib/auth/session", () => ({ requireSession }));
vi.mock("../../lib/auth/csrf", () => ({ assertCsrf }));
vi.mock("../../lib/payments/service", () => ({ createPayment, listPayments, getPaymentById: vi.fn(), enqueueReconcile: vi.fn() }));
const IDEM_PENDING = "__pending__";
vi.mock("../../lib/idempotency", () => ({
  IDEM_PENDING,
  // Model the real SET NX reservation: first caller wins, later callers see the
  // stored value (pending sentinel or finalized id).
  reserveIdempotent: vi.fn(async (s: string, k: string) => {
    const key = `${s}:${k}`;
    if (idemStore.has(key)) return { reserved: false, existing: idemStore.get(key) ?? null };
    idemStore.set(key, IDEM_PENDING);
    return { reserved: true, existing: null };
  }),
  setCachedIdempotent: vi.fn(async (s: string, k: string, v: string) => { idemStore.set(`${s}:${k}`, v); }),
  releaseIdempotent: vi.fn(async (s: string, k: string) => { idemStore.delete(`${s}:${k}`); }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  idemStore.clear();
  envMock.ENABLE_NEW_PAYMENTS = true;
  requireSession.mockResolvedValue({ id: "u1", username: "a", role: "MEMBER", tenantId: "t1" });
});

const makeReq = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/payments", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost", ...headers },
    body: JSON.stringify(body),
  });

const validBody = { recipientRef: "r", amount: "2500.00", sourceAsset: "USDC", targetCurrency: "PHP", anchorId: "a" };

describe("POST /api/payments", () => {
  it("returns 503 problem+json (never a 500) when new payments are gated off (#32)", async () => {
    envMock.ENABLE_NEW_PAYMENTS = false;
    const { POST } = await import("../../app/api/payments/route");
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(await res.json()).toMatchObject({ title: "New payments unavailable" });
    expect(createPayment).not.toHaveBeenCalled();
  });

  it("creates a payment and returns 201", async () => {
    createPayment.mockResolvedValue({ id: "pay_1", intentId: "intent_1", status: "PENDING" });
    const { POST } = await import("../../app/api/payments/route");
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: "pay_1", status: "PENDING" });
  });

  it("returns 422 problem+json on invalid body", async () => {
    const { POST } = await import("../../app/api/payments/route");
    const res = await POST(makeReq({ ...validBody, amount: "nope" }));
    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });

  it("idempotency-key returns the SAME payment without calling createPayment twice", async () => {
    createPayment.mockResolvedValue({ id: "pay_dedup", intentId: "intent_x", status: "PENDING" });
    const { POST } = await import("../../app/api/payments/route");
    const first = await POST(makeReq(validBody, { "idempotency-key": "abc" }));
    const second = await POST(makeReq(validBody, { "idempotency-key": "abc" }));
    expect((await first.json()).id).toBe("pay_dedup");
    expect((await second.json()).id).toBe("pay_dedup");
    expect(createPayment).toHaveBeenCalledOnce(); // second served from cache
  });

  it("returns 409 (no second submit) while a same-key request is still in flight (#143)", async () => {
    idemStore.set("payments:t1:inflight", IDEM_PENDING); // a concurrent request holds the reservation
    const { POST } = await import("../../app/api/payments/route");
    const res = await POST(makeReq(validBody, { "idempotency-key": "inflight" }));
    expect(res.status).toBe(409);
    expect(createPayment).not.toHaveBeenCalled();
  });

  it("releases the reservation if createPayment throws, so a retry can proceed (#143)", async () => {
    createPayment.mockRejectedValueOnce(new Error("soroban timeout"));
    const { POST } = await import("../../app/api/payments/route");
    const first = await POST(makeReq(validBody, { "idempotency-key": "retry" }));
    expect(first.status).toBe(500);
    // Reservation released → a retry reserves fresh and submits.
    createPayment.mockResolvedValue({ id: "pay_retry", intentId: "i", status: "PENDING" });
    const second = await POST(makeReq(validBody, { "idempotency-key": "retry" }));
    expect(second.status).toBe(201);
    expect((await second.json()).id).toBe("pay_retry");
  });
});

describe("GET /api/payments tenant scoping", () => {
  it("passes the session tenantId into listPayments", async () => {
    listPayments.mockResolvedValue({ items: [], nextCursor: null });
    const { GET } = await import("../../app/api/payments/route");
    const res = await GET(new Request("http://localhost/api/payments?limit=10"));
    expect(res.status).toBe(200);
    expect(listPayments).toHaveBeenCalledWith("t1", expect.objectContaining({ limit: 10 }));
  });
});
