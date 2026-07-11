import "server-only";

import { z } from "zod";

import { forTenant } from "../db";
import { Prisma } from "../generated/prisma/client";
import { AppError } from "../http/problem";

/**
 * Employee onboarding / HR (#133). The durable model of who an employee is, what
 * they're owed per cycle, and what their compensation package contains — the
 * foundation payroll, salary advance (#134), and non-monetary conversion (#135)
 * read from. Every model is tenant-scoped via `forTenant()`; compensation
 * packages are effective-dated so raises/changes are auditable (a new version
 * supersedes the prior one; the prior row is retained).
 */

const decimalString = z
  .string()
  .trim()
  .refine((v) => {
    try {
      new Prisma.Decimal(v);
      return true;
    } catch {
      return false;
    }
  }, "must be a valid decimal");

export const roleInput = z.object({
  title: z.string().trim().min(1).max(120),
  seniorityBand: z.string().trim().max(60).optional(),
});

export const packageItemInput = z
  .object({
    type: z.enum(["BASE_SALARY", "BONUS", "ALLOWANCE", "BENEFIT_NON_MONETARY"]),
    label: z.string().trim().min(1).max(160),
    amount: decimalString.optional(),
    currency: z.string().trim().min(1).max(12).optional(),
    notionalValue: decimalString.optional(),
    cadence: z.enum(["MONTHLY", "ANNUAL", "ONE_OFF"]).default("MONTHLY"),
    convertible: z.boolean().default(false),
  })
  .refine(
    (item) =>
      item.type === "BENEFIT_NON_MONETARY"
        ? item.notionalValue != null
        : item.amount != null && item.currency != null,
    { message: "monetary items require amount + currency; non-monetary items require notionalValue" },
  );

export const packageInput = z.object({
  effectiveFrom: z.coerce.date().optional(),
  items: z.array(packageItemInput).min(1, "a package needs at least one item"),
});

export const onboardInput = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().email().max(200),
  startDate: z.coerce.date().optional(),
  status: z.enum(["ACTIVE", "ON_LEAVE", "TERMINATED"]).default("ACTIVE"),
  roleId: z.string().trim().min(1).optional(),
  receiverId: z.string().trim().min(1).optional(),
  package: packageInput,
});

export type RoleInput = z.infer<typeof roleInput>;
export type PackageItemInput = z.infer<typeof packageItemInput>;
export type PackageInput = z.infer<typeof packageInput>;
export type OnboardInput = z.infer<typeof onboardInput>;

export type PackageItemView = {
  id: string;
  type: string;
  label: string;
  amount: string | null;
  currency: string | null;
  notionalValue: string | null;
  cadence: string;
  convertible: boolean;
};
export type PackageView = {
  id: string;
  effectiveFrom: string;
  supersededAt: string | null;
  items: PackageItemView[];
};
export type EmployeeView = {
  id: string;
  name: string;
  email: string;
  status: string;
  startDate: string;
  role: { id: string; title: string } | null;
  receiverId: string | null;
  currentPackage: PackageView | null;
};
export type EmployeeDetail = EmployeeView & { packages: PackageView[] };
export type RoleView = { id: string; title: string; seniorityBand: string | null };

const PACKAGE_INCLUDE = { items: { orderBy: { createdAt: "asc" } } } satisfies Prisma.CompensationPackageInclude;

type PackageRow = Prisma.CompensationPackageGetPayload<{ include: typeof PACKAGE_INCLUDE }>;

function itemView(i: PackageRow["items"][number]): PackageItemView {
  return {
    id: i.id,
    type: i.type,
    label: i.label,
    amount: i.amount ? i.amount.toString() : null,
    currency: i.currency,
    notionalValue: i.notionalValue ? i.notionalValue.toString() : null,
    cadence: i.cadence,
    convertible: i.convertible,
  };
}
function packageView(p: PackageRow): PackageView {
  return {
    id: p.id,
    effectiveFrom: p.effectiveFrom.toISOString(),
    supersededAt: p.supersededAt ? p.supersededAt.toISOString() : null,
    items: p.items.map(itemView),
  };
}

function itemCreateData(tenantId: string, items: PackageItemInput[]) {
  return items.map((i) => ({
    tenantId,
    type: i.type,
    label: i.label,
    amount: i.amount ?? null,
    currency: i.currency ?? null,
    notionalValue: i.notionalValue ?? null,
    cadence: i.cadence,
    convertible: i.convertible,
  }));
}

// ---- Roles ---------------------------------------------------------------

export async function createRole(tenantId: string, input: RoleInput): Promise<RoleView> {
  const db = forTenant(tenantId);
  try {
    const r = await db.employeeRole.create({
      data: { tenantId, title: input.title, seniorityBand: input.seniorityBand ?? null },
    });
    return { id: r.id, title: r.title, seniorityBand: r.seniorityBand };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new AppError(409, "Duplicate role", `A role titled "${input.title}" already exists.`);
    }
    throw e;
  }
}

export async function listRoles(tenantId: string): Promise<RoleView[]> {
  const rows = await forTenant(tenantId).employeeRole.findMany({ orderBy: { title: "asc" } });
  return rows.map((r) => ({ id: r.id, title: r.title, seniorityBand: r.seniorityBand }));
}

// ---- Employees -----------------------------------------------------------

export async function onboardEmployee(
  tenantId: string,
  userId: string,
  input: OnboardInput,
  now: Date = new Date(),
): Promise<EmployeeDetail> {
  const db = forTenant(tenantId);

  if (input.roleId) {
    const role = await db.employeeRole.findFirst({ where: { id: input.roleId } });
    if (!role) throw new AppError(400, "Unknown role", "The selected role does not exist for this tenant.");
  }
  // Receiver is a GLOBAL persona (a receiver can be paid by any tenant), so this
  // is an existence guard for a clean 400 rather than an FK crash — not a
  // tenant-ownership check (there is no tenant ownership on Receiver to enforce).
  if (input.receiverId) {
    const receiver = await db.receiver.findFirst({ where: { id: input.receiverId } });
    if (!receiver) throw new AppError(400, "Unknown receiver", "The selected receiver does not exist.");
  }

  try {
    const employee = await db.employee.create({
      data: {
        tenantId,
        name: input.name,
        email: input.email,
        status: input.status,
        startDate: input.startDate ?? now,
        roleId: input.roleId ?? null,
        receiverId: input.receiverId ?? null,
        packages: {
          create: {
            tenantId,
            effectiveFrom: input.package.effectiveFrom ?? now,
            createdByUserId: userId,
            items: { create: itemCreateData(tenantId, input.package.items) },
          },
        },
      },
    });
    return (await getEmployee(tenantId, employee.id))!;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new AppError(409, "Duplicate employee", `An employee with email ${input.email} already exists.`);
    }
    throw e;
  }
}

export async function listEmployees(tenantId: string): Promise<EmployeeView[]> {
  const rows = await forTenant(tenantId).employee.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      role: true,
      packages: { where: { supersededAt: null }, include: PACKAGE_INCLUDE, take: 1 },
    },
  });
  return rows.map((e) => ({
    id: e.id,
    name: e.name,
    email: e.email,
    status: e.status,
    startDate: e.startDate.toISOString(),
    role: e.role ? { id: e.role.id, title: e.role.title } : null,
    receiverId: e.receiverId,
    currentPackage: e.packages[0] ? packageView(e.packages[0]) : null,
  }));
}

export async function getEmployee(tenantId: string, id: string): Promise<EmployeeDetail | null> {
  const e = await forTenant(tenantId).employee.findFirst({
    where: { id },
    include: {
      role: true,
      packages: { orderBy: { effectiveFrom: "desc" }, include: PACKAGE_INCLUDE },
    },
  });
  if (!e) return null;
  const packages = e.packages.map(packageView);
  return {
    id: e.id,
    name: e.name,
    email: e.email,
    status: e.status,
    startDate: e.startDate.toISOString(),
    role: e.role ? { id: e.role.id, title: e.role.title } : null,
    receiverId: e.receiverId,
    currentPackage: packages.find((p) => p.supersededAt === null) ?? null,
    packages,
  };
}

/**
 * Set a new effective-dated compensation package. Supersedes the current active
 * package (retaining it as history) and creates the new version.
 */
export async function setPackage(
  tenantId: string,
  employeeId: string,
  userId: string,
  input: PackageInput,
  now: Date = new Date(),
): Promise<EmployeeDetail> {
  const db = forTenant(tenantId);
  const employee = await db.employee.findFirst({ where: { id: employeeId } });
  if (!employee) throw new AppError(404, "Employee not found", "No such employee for this tenant.");

  const effectiveFrom = input.effectiveFrom ?? now;
  // Atomic supersede-then-create: without a transaction a failed create would
  // leave the employee with no active package, and concurrent calls could leave
  // two active packages (both supersededAt = null). Run both in one transaction
  // so the "exactly one active package" invariant holds.
  await db.$transaction([
    db.compensationPackage.updateMany({
      where: { employeeId, supersededAt: null },
      data: { supersededAt: now },
    }),
    db.compensationPackage.create({
      data: {
        tenantId,
        employeeId,
        effectiveFrom,
        createdByUserId: userId,
        items: { create: itemCreateData(tenantId, input.items) },
      },
    }),
  ]);
  return (await getEmployee(tenantId, employeeId))!;
}
