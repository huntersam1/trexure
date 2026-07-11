import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http/problem";
import {
  createRole,
  listRoles,
  onboardEmployee,
  listEmployees,
  getEmployee,
  setPackage,
  type OnboardInput,
} from "./employees";

const TENANT = "test_tenant_hr_133";
const OTHER = "test_tenant_hr_133_other";
const USER = "u_hr_133";
const T1 = new Date("2026-07-01T00:00:00.000Z");
const T2 = new Date("2026-08-01T00:00:00.000Z");

function onboardPayload(over: Partial<OnboardInput> = {}): OnboardInput {
  return {
    name: "Maria Santos",
    email: "maria@acme.test",
    status: "ACTIVE",
    package: {
      items: [
        { type: "BASE_SALARY", label: "Base salary", amount: "50000", currency: "PHP", cadence: "MONTHLY", convertible: false },
        { type: "BENEFIT_NON_MONETARY", label: "20 days PTO", notionalValue: "40000", cadence: "ANNUAL", convertible: true },
      ],
    },
    ...over,
  } as OnboardInput;
}

beforeAll(async () => {
  for (const id of [TENANT, OTHER]) {
    await prisma.tenant.upsert({ where: { id }, update: {}, create: { id, name: `HR ${id}` } });
  }
  await prisma.user.upsert({
    where: { id: USER },
    update: {},
    create: { id: USER, tenantId: TENANT, username: "hr-admin", passwordHash: "x", role: "ADMIN" },
  });
});

afterAll(async () => {
  for (const id of [TENANT, OTHER]) {
    await prisma.packageItem.deleteMany({ where: { tenantId: id } });
    await prisma.compensationPackage.deleteMany({ where: { tenantId: id } });
    await prisma.employee.deleteMany({ where: { tenantId: id } });
    await prisma.employeeRole.deleteMany({ where: { tenantId: id } });
  }
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER] } } });
});

describe("roles", () => {
  it("creates a tenant role and rejects a duplicate title", async () => {
    const r = await createRole(TENANT, { title: "Engineer", seniorityBand: "IC3" });
    expect(r.title).toBe("Engineer");
    await expect(createRole(TENANT, { title: "Engineer" })).rejects.toBeInstanceOf(AppError);
    expect((await listRoles(TENANT)).some((x) => x.title === "Engineer")).toBe(true);
  });
});

describe("onboardEmployee", () => {
  it("onboards with role, base salary, and a non-monetary item", async () => {
    const role = await createRole(TENANT, { title: "Designer" });
    const emp = await onboardEmployee(TENANT, USER, onboardPayload({ roleId: role.id, startDate: T1 }), T1);

    expect(emp.name).toBe("Maria Santos");
    expect(emp.role?.title).toBe("Designer");
    expect(emp.startDate).toBe(T1.toISOString());
    expect(emp.currentPackage?.items).toHaveLength(2);
    const base = emp.currentPackage!.items.find((i) => i.type === "BASE_SALARY")!;
    expect(base.amount).toBe("50000");
    expect(base.currency).toBe("PHP");
    const pto = emp.currentPackage!.items.find((i) => i.type === "BENEFIT_NON_MONETARY")!;
    expect(pto.notionalValue).toBe("40000");
    expect(pto.convertible).toBe(true);
    expect(pto.amount).toBeNull();
  });

  it("rejects a duplicate employee email within the tenant", async () => {
    await onboardEmployee(TENANT, USER, onboardPayload({ email: "dup@acme.test" }), T1);
    await expect(
      onboardEmployee(TENANT, USER, onboardPayload({ email: "dup@acme.test" }), T1),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe("setPackage — effective-dated versioning", () => {
  it("supersedes the prior package but retains it as history", async () => {
    const emp = await onboardEmployee(TENANT, USER, onboardPayload({ email: "raise@acme.test" }), T1);
    const firstPackageId = emp.currentPackage!.id;

    const updated = await setPackage(
      TENANT,
      emp.id,
      USER,
      { items: [{ type: "BASE_SALARY", label: "Base salary", amount: "60000", currency: "PHP", cadence: "MONTHLY", convertible: false }] },
      T2,
    );

    // Current package is the new one; prior is retained + superseded.
    expect(updated.currentPackage!.id).not.toBe(firstPackageId);
    expect(updated.currentPackage!.items[0]!.amount).toBe("60000");
    expect(updated.packages).toHaveLength(2);
    const prior = updated.packages.find((p) => p.id === firstPackageId)!;
    expect(prior.supersededAt).toBe(T2.toISOString());
    expect(prior.items.find((i) => i.type === "BASE_SALARY")!.amount).toBe("50000");
  });
});

describe("tenant isolation", () => {
  it("hides another tenant's employees and refuses to repackage them", async () => {
    const mine = await onboardEmployee(TENANT, USER, onboardPayload({ email: "iso@acme.test" }), T1);

    // OTHER tenant cannot see or fetch it.
    expect(await getEmployee(OTHER, mine.id)).toBeNull();
    expect((await listEmployees(OTHER)).some((e) => e.id === mine.id)).toBe(false);

    // OTHER tenant cannot set a package on it (scoped lookup fails → 404).
    await expect(
      setPackage(OTHER, mine.id, USER, { items: [{ type: "BASE_SALARY", label: "x", amount: "1", currency: "PHP", cadence: "MONTHLY", convertible: false }] }),
    ).rejects.toBeInstanceOf(AppError);
  });
});
