import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { AppError } from "@/lib/http/problem";
import { onboardEmployee } from "./employees";
import {
  valuation,
  setConversionPolicy,
  getConversionPolicy,
  listConvertibleItems,
  requestConversion,
  approveConversion,
  markConversionDisbursed,
  rejectConversion,
  listConversions,
} from "./conversions";

const TENANT = "test_tenant_conv_135";
const OTHER = "test_tenant_conv_135_other";
const USER = "u_conv_135";

async function seedEmployeeWithConvertible(tenantId: string, email: string): Promise<{ employeeId: string; itemId: string }> {
  const emp = await onboardEmployee(tenantId, USER, {
    name: "Convertible Person",
    email,
    status: "ACTIVE",
    package: {
      items: [
        { type: "BASE_SALARY", label: "Base", amount: "50000", currency: "PHP", cadence: "MONTHLY", convertible: false },
        { type: "BENEFIT_NON_MONETARY", label: "PTO buy-back", notionalValue: "40000", cadence: "ANNUAL", convertible: true },
      ],
    },
  } as never);
  const item = emp.currentPackage!.items.find((i) => i.type === "BENEFIT_NON_MONETARY")!;
  return { employeeId: emp.id, itemId: item.id };
}

beforeAll(async () => {
  for (const id of [TENANT, OTHER]) {
    await prisma.tenant.upsert({ where: { id }, update: {}, create: { id, name: `Conv ${id}` } });
  }
  await prisma.user.upsert({
    where: { id: USER },
    update: {},
    create: { id: USER, tenantId: TENANT, username: "conv-admin", passwordHash: "x", role: "ADMIN" },
  });
});

afterAll(async () => {
  for (const id of [TENANT, OTHER]) {
    await prisma.packageConversion.deleteMany({ where: { tenantId: id } });
    await prisma.packageItem.deleteMany({ where: { tenantId: id } });
    await prisma.compensationPackage.deleteMany({ where: { tenantId: id } });
    await prisma.employee.deleteMany({ where: { tenantId: id } });
    await prisma.conversionPolicy.deleteMany({ where: { tenantId: id } });
  }
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER] } } });
});

describe("valuation", () => {
  it("is identity at 100% rate / 0% fee", () => {
    const v = valuation(new Prisma.Decimal("1000"), { ratePercent: "100", feePercent: "0", perConversionCap: null });
    expect(v.cashValue.toString()).toBe("1000");
    expect(v.fee.toString()).toBe("0");
    expect(v.net.toString()).toBe("1000");
  });

  it("applies a haircut and fee deterministically", () => {
    const v = valuation(new Prisma.Decimal("1000"), { ratePercent: "90", feePercent: "5", perConversionCap: null });
    expect(v.cashValue.toString()).toBe("900"); // 1000 × 90%
    expect(v.fee.toString()).toBe("45"); // 900 × 5%
    expect(v.net.toString()).toBe("855");
  });
});

describe("policy", () => {
  it("defaults to 100% / 0% and is upsertable", async () => {
    expect(await getConversionPolicy(TENANT)).toEqual({ ratePercent: "100", feePercent: "0", perConversionCap: null });
    const set = await setConversionPolicy(TENANT, { ratePercent: 90, feePercent: 5, perConversionCap: "10000" });
    expect(set).toEqual({ ratePercent: "90", feePercent: "5", perConversionCap: "10000" });
    // Idempotent update (no duplicate policy row).
    await setConversionPolicy(TENANT, { ratePercent: 80, feePercent: 2 });
    expect((await getConversionPolicy(TENANT)).ratePercent).toBe("80");
  });
});

describe("requestConversion", () => {
  it("reserves the balance, creates the conversion, and shrinks remaining", async () => {
    await setConversionPolicy(TENANT, { ratePercent: 100, feePercent: 0 });
    const { employeeId, itemId } = await seedEmployeeWithConvertible(TENANT, "req@acme.test");

    const before = await listConvertibleItems(TENANT, employeeId);
    expect(before[0]!.remaining).toBe("40000");
    expect(before[0]!.estimatedCash).toBe("40000");

    const conv = await requestConversion(TENANT, employeeId, USER, { packageItemId: itemId, notionalAmount: "15000" });
    expect(conv.status).toBe("REQUESTED");
    expect(conv.cashValue).toBe("15000");
    expect(conv.net).toBe("15000");

    const after = await listConvertibleItems(TENANT, employeeId);
    expect(after[0]!.remaining).toBe("25000"); // 40000 − 15000 reserved
  });

  it("refuses to over-convert beyond the remaining balance", async () => {
    const { employeeId, itemId } = await seedEmployeeWithConvertible(TENANT, "over@acme.test");
    await expect(
      requestConversion(TENANT, employeeId, USER, { packageItemId: itemId, notionalAmount: "50000" }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("refuses a non-convertible (monetary) item", async () => {
    const emp = await onboardEmployee(TENANT, USER, {
      name: "Mono", email: "mono@acme.test", status: "ACTIVE",
      package: { items: [{ type: "BASE_SALARY", label: "Base", amount: "50000", currency: "PHP", cadence: "MONTHLY", convertible: false }] },
    } as never);
    const baseId = emp.currentPackage!.items[0]!.id;
    await expect(
      requestConversion(TENANT, emp.id, USER, { packageItemId: baseId, notionalAmount: "100" }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe("lifecycle", () => {
  it("approve → markDisbursed advances status and links the payment", async () => {
    const { employeeId, itemId } = await seedEmployeeWithConvertible(TENANT, "life@acme.test");
    const conv = await requestConversion(TENANT, employeeId, USER, { packageItemId: itemId, notionalAmount: "10000" });
    const approved = await approveConversion(TENANT, conv.id, USER);
    expect(approved.status).toBe("APPROVED");
    const disbursed = await markConversionDisbursed(TENANT, conv.id, "pay_conv_1");
    expect(disbursed.status).toBe("DISBURSED");
    expect(disbursed.paymentId).toBe("pay_conv_1");
    expect((await listConversions(TENANT, employeeId)).some((c) => c.id === conv.id)).toBe(true);
  });

  it("reject releases the reserved balance", async () => {
    const { employeeId, itemId } = await seedEmployeeWithConvertible(TENANT, "rej@acme.test");
    const conv = await requestConversion(TENANT, employeeId, USER, { packageItemId: itemId, notionalAmount: "12000" });
    expect((await listConvertibleItems(TENANT, employeeId))[0]!.remaining).toBe("28000");
    const rejected = await rejectConversion(TENANT, conv.id, USER);
    expect(rejected.status).toBe("REJECTED");
    expect((await listConvertibleItems(TENANT, employeeId))[0]!.remaining).toBe("40000"); // restored
  });

  it("approve is a guarded transition — a second approve 409s (no double-pay)", async () => {
    const { employeeId, itemId } = await seedEmployeeWithConvertible(TENANT, "guard@acme.test");
    const conv = await requestConversion(TENANT, employeeId, USER, { packageItemId: itemId, notionalAmount: "5000" });
    await approveConversion(TENANT, conv.id, USER);
    await expect(approveConversion(TENANT, conv.id, USER)).rejects.toBeInstanceOf(AppError);
  });

  it("a disbursed conversion cannot be rejected (balance not double-released)", async () => {
    const { employeeId, itemId } = await seedEmployeeWithConvertible(TENANT, "disb@acme.test");
    const conv = await requestConversion(TENANT, employeeId, USER, { packageItemId: itemId, notionalAmount: "5000" });
    await approveConversion(TENANT, conv.id, USER);
    await markConversionDisbursed(TENANT, conv.id, "pay_x");
    await expect(rejectConversion(TENANT, conv.id, USER)).rejects.toBeInstanceOf(AppError);
    // Reserved balance stays consumed (still 35000 remaining), not released.
    expect((await listConvertibleItems(TENANT, employeeId))[0]!.remaining).toBe("35000");
  });
});

describe("tenant isolation", () => {
  it("cannot convert or reject another tenant's item/conversion", async () => {
    const { employeeId, itemId } = await seedEmployeeWithConvertible(TENANT, "iso@acme.test");
    await expect(
      requestConversion(OTHER, employeeId, USER, { packageItemId: itemId, notionalAmount: "100" }),
    ).rejects.toBeInstanceOf(AppError);

    const conv = await requestConversion(TENANT, employeeId, USER, { packageItemId: itemId, notionalAmount: "100" });
    await expect(rejectConversion(OTHER, conv.id, USER)).rejects.toBeInstanceOf(AppError);
    expect(await listConversions(OTHER)).toHaveLength(0);
  });
});
