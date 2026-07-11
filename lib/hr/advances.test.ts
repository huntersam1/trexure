import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { AppError } from "@/lib/http/problem";
import { onboardEmployee } from "./employees";
import {
  getAdvancePolicy,
  setAdvancePolicy,
  computeEligibility,
  requestAdvance,
  approveAdvance,
  markAdvanceDisbursed,
  rejectAdvance,
  computeSalaryPayout,
  settleAdvancesForPayout,
  listAdvances,
} from "./advances";

const TENANT = "test_tenant_adv_134";
const OTHER = "test_tenant_adv_134_other";
const USER = "u_adv_134";
const EOM = new Date("2026-06-30T12:00:00.000Z"); // day 30 of 30 → accrued = full month base

async function employeeWithSalary(tenantId: string, email: string, base = "1000"): Promise<string> {
  const emp = await onboardEmployee(tenantId, USER, {
    name: "Salary Person",
    email,
    status: "ACTIVE",
    package: { items: [{ type: "BASE_SALARY", label: "Base", amount: base, currency: "XLM", cadence: "MONTHLY", convertible: false }] },
  } as never);
  return emp.id;
}

beforeAll(async () => {
  for (const id of [TENANT, OTHER]) {
    await prisma.tenant.upsert({ where: { id }, update: {}, create: { id, name: `Adv ${id}` } });
  }
  await prisma.user.upsert({
    where: { id: USER },
    update: {},
    create: { id: USER, tenantId: TENANT, username: "adv-admin", passwordHash: "x", role: "ADMIN" },
  });
});

afterAll(async () => {
  for (const id of [TENANT, OTHER]) {
    await prisma.salaryAdvance.deleteMany({ where: { tenantId: id } });
    await prisma.packageItem.deleteMany({ where: { tenantId: id } });
    await prisma.compensationPackage.deleteMany({ where: { tenantId: id } });
    await prisma.employee.deleteMany({ where: { tenantId: id } });
    await prisma.advancePolicy.deleteMany({ where: { tenantId: id } });
  }
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER] } } });
});

describe("policy", () => {
  it("defaults to 50% / 0% fee and is upsertable", async () => {
    expect(await getAdvancePolicy(TENANT)).toEqual({ maxPercentAccrued: "50", feePercent: "0", perCycleCap: null, autoApproveUnder: null });
    const set = await setAdvancePolicy(TENANT, { maxPercentAccrued: 40, feePercent: 2, perCycleCap: "800", autoApproveUnder: "200" });
    expect(set).toEqual({ maxPercentAccrued: "40", feePercent: "2", perCycleCap: "800", autoApproveUnder: "200" });
  });
});

describe("computeEligibility", () => {
  it("accrues pro-rata and applies max-percent minus outstanding", async () => {
    await setAdvancePolicy(TENANT, { maxPercentAccrued: 50, feePercent: 0 });
    const employeeId = await employeeWithSalary(TENANT, "elig@acme.test", "1000");
    const e = await computeEligibility(TENANT, employeeId, EOM);
    expect(e.monthlyBase).toBe("1000");
    expect(e.accrued).toBe("1000"); // full month at EOM
    expect(e.maxAdvanceable).toBe("500"); // 50% of accrued
    expect(e.eligible).toBe("500");
  });
});

describe("requestAdvance", () => {
  it("creates within limit and refuses over the eligible amount", async () => {
    await setAdvancePolicy(TENANT, { maxPercentAccrued: 50, feePercent: 0 });
    const employeeId = await employeeWithSalary(TENANT, "req@acme.test", "1000");
    const adv = await requestAdvance(TENANT, USER, { employeeId, amount: "300" }, EOM);
    expect(adv.status).toBe("REQUESTED");
    expect(adv.outstanding).toBe("300");
    // Eligible now 500 − 300 = 200; a 300 request exceeds it.
    await expect(requestAdvance(TENANT, USER, { employeeId, amount: "300" }, EOM)).rejects.toBeInstanceOf(AppError);
  });

  it("auto-approves under the policy threshold and charges the fee", async () => {
    await setAdvancePolicy(TENANT, { maxPercentAccrued: 50, feePercent: 10, autoApproveUnder: "500" });
    const employeeId = await employeeWithSalary(TENANT, "auto@acme.test", "1000");
    const adv = await requestAdvance(TENANT, USER, { employeeId, amount: "200" }, EOM);
    expect(adv.status).toBe("APPROVED");
    expect(adv.fee).toBe("20"); // 10% of 200
    expect(adv.outstanding).toBe("220");
  });
});

describe("guarded lifecycle", () => {
  it("approve/disburse are guarded compare-and-sets", async () => {
    await setAdvancePolicy(TENANT, { maxPercentAccrued: 50, feePercent: 0 });
    const employeeId = await employeeWithSalary(TENANT, "life@acme.test", "1000");
    const adv = await requestAdvance(TENANT, USER, { employeeId, amount: "100" }, EOM);
    await approveAdvance(TENANT, adv.id);
    await expect(approveAdvance(TENANT, adv.id)).rejects.toBeInstanceOf(AppError); // no double-approve
    const disbursed = await markAdvanceDisbursed(TENANT, adv.id, "pay_adv_1");
    expect(disbursed.status).toBe("DISBURSED");
    expect(disbursed.paymentId).toBe("pay_adv_1");
  });

  it("reject clears outstanding so it stops counting against eligibility", async () => {
    await setAdvancePolicy(TENANT, { maxPercentAccrued: 50, feePercent: 0 });
    const employeeId = await employeeWithSalary(TENANT, "rej@acme.test", "1000");
    const adv = await requestAdvance(TENANT, USER, { employeeId, amount: "400" }, EOM);
    expect((await computeEligibility(TENANT, employeeId, EOM)).eligible).toBe("100"); // 500 − 400
    const rejected = await rejectAdvance(TENANT, adv.id);
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.outstanding).toBe("0");
    expect((await computeEligibility(TENANT, employeeId, EOM)).eligible).toBe("500"); // restored
  });
});

describe("salary payout netting", () => {
  it("nets a full advance out of the salary payout and marks it repaid", async () => {
    await setAdvancePolicy(TENANT, { maxPercentAccrued: 50, feePercent: 0 });
    const employeeId = await employeeWithSalary(TENANT, "net@acme.test", "1000");
    const adv = await requestAdvance(TENANT, USER, { employeeId, amount: "300" }, EOM);
    await approveAdvance(TENANT, adv.id);
    await markAdvanceDisbursed(TENANT, adv.id, "pay_net_adv");

    const payout = await computeSalaryPayout(TENANT, employeeId);
    expect(payout.gross).toBe("1000");
    expect(payout.deduction).toBe("300");
    expect(payout.net).toBe("700");

    const repaid = await settleAdvancesForPayout(TENANT, employeeId, new Prisma.Decimal(payout.deduction), "pay_salary_1");
    expect(repaid.toString()).toBe("300");
    expect((await listAdvances(TENANT, employeeId))[0]!.status).toBe("REPAID");
  });

  it("applies a partial deduction FIFO across advances (multi-cycle)", async () => {
    const employeeId = await employeeWithSalary(TENANT, "fifo@acme.test", "1000");
    // Two disbursed advances, 300 outstanding each, created directly to model prior cycles.
    for (const suffix of ["a", "b"]) {
      await prisma.salaryAdvance.create({
        data: { tenantId: TENANT, employeeId, amount: "300", fee: "0", outstanding: "300", status: "DISBURSED", paymentId: `d_${suffix}` },
      });
    }
    // Deduct only 400 — clears the first, partially pays the second.
    const repaid = await settleAdvancesForPayout(TENANT, employeeId, new Prisma.Decimal("400"), "pay_salary_2");
    expect(repaid.toString()).toBe("400");
    const advs = (await listAdvances(TENANT, employeeId)).filter((a) => ["DISBURSED", "REPAID"].includes(a.status));
    const repaidCount = advs.filter((a) => a.status === "REPAID").length;
    const stillOwing = advs.find((a) => a.status === "DISBURSED");
    expect(repaidCount).toBe(1);
    expect(stillOwing?.outstanding).toBe("200"); // 300 − 100 applied
  });
});

describe("tenant isolation", () => {
  it("cannot see or act on another tenant's advances", async () => {
    const employeeId = await employeeWithSalary(TENANT, "iso@acme.test", "1000");
    const adv = await requestAdvance(TENANT, USER, { employeeId, amount: "100" }, EOM);
    await expect(approveAdvance(OTHER, adv.id)).rejects.toBeInstanceOf(AppError);
    expect(await listAdvances(OTHER)).toHaveLength(0);
  });
});
