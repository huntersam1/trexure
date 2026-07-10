import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http/problem";
import { verifyAttestation } from "./attestation";
import {
  createDisclosureLink,
  resolveDisclosureLink,
  revokeDisclosureLink,
} from "./disclosure-link";

const TENANT = "test_tenant_disclosure_128";
const OTHER = "test_tenant_disclosure_128_other";
const USER = "u_disclosure_128";
const T0 = new Date("2026-07-10T12:00:00.000Z");
const PAST_EXPIRY = new Date(T0.getTime() + 1000 * 60 * 60 * 24 * 31); // 31d > 30d TTL

async function settledPayment(tenantId: string, intent: string): Promise<string> {
  const p = await prisma.payment.create({
    data: {
      tenantId,
      intentId: intent,
      status: "SETTLED",
      sourceAsset: "XLM",
      sourceAmount: "100",
      targetCurrency: "PHP",
      targetAmount: "640",
      corridorFrom: "XLM",
      corridorTo: "PHP",
      recipientRef: "Vendor A",
      payoutMethod: "POOL_BANK",
      legs: {
        create: [
          { legType: "ONCHAIN", status: "CONFIRMED", txHash: `tx_${intent}` },
          { legType: "FIAT", status: "RECEIVED", bankRef: `BPI-${intent}` },
        ],
      },
    },
  });
  await prisma.receipt.create({ data: { paymentId: p.id, json: { id: `rcpt_${intent}` } } });
  return p.id;
}

let settledId: string;
let pendingId: string;

beforeAll(async () => {
  for (const id of [TENANT, OTHER]) {
    await prisma.tenant.upsert({ where: { id }, update: {}, create: { id, name: `Disc ${id}` } });
  }
  await prisma.user.upsert({
    where: { id: USER },
    update: {},
    create: { id: USER, tenantId: TENANT, username: "disc-admin", passwordHash: "x", role: "ADMIN" },
  });

  settledId = await settledPayment(TENANT, "disc_settled");
  const pending = await prisma.payment.create({
    data: {
      tenantId: TENANT,
      intentId: "disc_pending",
      status: "PENDING",
      sourceAsset: "XLM",
      sourceAmount: "10",
      targetCurrency: "XLM",
      corridorFrom: "XLM",
      corridorTo: "XLM",
      recipientRef: "Vendor B",
    },
  });
  pendingId = pending.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: [TENANT, OTHER] } } });
  await prisma.disclosureLink.deleteMany({ where: { tenantId: { in: [TENANT, OTHER] } } });
  await prisma.payment.deleteMany({ where: { tenantId: { in: [TENANT, OTHER] } } });
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER] } } });
});

describe("createDisclosureLink", () => {
  it("mints a rotating link, persists only the token hash, and audit-logs the issue", async () => {
    const minted = await createDisclosureLink(TENANT, settledId, USER, T0);
    expect(minted.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(minted.url).toContain(`/verify/${minted.token}`);

    const row = await prisma.disclosureLink.findUnique({ where: { paymentId: settledId } });
    expect(row?.tenantId).toBe(TENANT);
    // Raw token is never stored — only its sha256.
    expect(JSON.stringify(row)).not.toContain(minted.token);

    const issued = await prisma.auditLog.count({
      where: { tenantId: TENANT, action: "disclosure.link.issued", target: settledId },
    });
    expect(issued).toBeGreaterThanOrEqual(1);
  });

  it("refuses to mint for a non-settled payment", async () => {
    await expect(createDisclosureLink(TENANT, pendingId, USER, T0)).rejects.toBeInstanceOf(AppError);
  });

  it("refuses to mint another tenant's payment (cross-tenant)", async () => {
    await expect(createDisclosureLink(OTHER, settledId, USER, T0)).rejects.toBeInstanceOf(AppError);
  });
});

describe("resolveDisclosureLink", () => {
  it("resolves a valid token to a tamper-verifiable attestation and records the view", async () => {
    const { token } = await createDisclosureLink(TENANT, settledId, USER, T0);
    const res = await resolveDisclosureLink(token, T0);

    expect(res.status).toBe("ok");
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.attestation.paymentId).toBe(settledId);
    expect(res.attestation.tenantId).toBe(TENANT);
    expect(verifyAttestation(res.attestation)).toBe(true);

    const row = await prisma.disclosureLink.findUnique({ where: { paymentId: settledId } });
    expect(row?.viewCount).toBeGreaterThanOrEqual(1);
    const viewed = await prisma.auditLog.count({
      where: { tenantId: TENANT, action: "disclosure.link.viewed", target: settledId },
    });
    expect(viewed).toBeGreaterThanOrEqual(1);
  });

  it("returns invalid for an unknown token", async () => {
    expect((await resolveDisclosureLink("not-a-real-token", T0)).status).toBe("invalid");
    expect((await resolveDisclosureLink("", T0)).status).toBe("invalid");
  });

  it("returns invalid for an expired token", async () => {
    const { token } = await createDisclosureLink(TENANT, settledId, USER, T0);
    expect((await resolveDisclosureLink(token, PAST_EXPIRY)).status).toBe("invalid");
  });

  it("returns invalid for a revoked token", async () => {
    const { token } = await createDisclosureLink(TENANT, settledId, USER, T0);
    const revoked = await revokeDisclosureLink(TENANT, settledId, USER, T0);
    expect(revoked).toBe(true);
    expect((await resolveDisclosureLink(token, T0)).status).toBe("invalid");
  });
});

describe("revokeDisclosureLink", () => {
  it("returns false when there is no active link to revoke", async () => {
    await createDisclosureLink(TENANT, settledId, USER, T0);
    expect(await revokeDisclosureLink(TENANT, settledId, USER, T0)).toBe(true);
    // Second revoke: nothing active left.
    expect(await revokeDisclosureLink(TENANT, settledId, USER, T0)).toBe(false);
  });
});
