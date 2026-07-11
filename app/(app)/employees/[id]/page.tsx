import "server-only";
import type { JSX } from "react";
import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { requireSession } from "@/lib/auth/session";
import { getEmployee, type PackageView } from "@/lib/hr/employees";
import { listConvertibleItems, listConversions } from "@/lib/hr/conversions";
import { computeEligibility, listAdvances } from "@/lib/hr/advances";
import { CSRF_COOKIE_NAME } from "@/lib/auth/csrf";
import { Icon } from "@/components/ui/Icon";
import { ConversionPanel } from "./ConversionPanel";
import { AdvancePanel } from "./AdvancePanel";

export const dynamic = "force-dynamic";

function itemAmount(i: PackageView["items"][number]): string {
  if (i.type === "BENEFIT_NON_MONETARY") return i.notionalValue ? `${i.notionalValue} (notional)` : "—";
  return i.amount ? `${i.amount} ${i.currency ?? ""}`.trim() : "—";
}

function PackageCard({ pkg, current }: { pkg: PackageView; current: boolean }): JSX.Element {
  return (
    <div className={`rounded-xl border p-5 ${current ? "border-primary/40 bg-primary/5" : "border-outline-variant bg-surface"}`}>
      <div className="flex items-center justify-between">
        <span className="text-label-mono uppercase tracking-widest text-on-surface-variant/70">
          Effective {pkg.effectiveFrom.slice(0, 10)}
        </span>
        <span
          className={`rounded-full px-2.5 py-1 text-label-mono font-bold ${
            current ? "bg-primary/15 text-primary" : "bg-surface-container-highest text-on-surface-variant"
          }`}
        >
          {current ? "current" : `superseded ${pkg.supersededAt?.slice(0, 10) ?? ""}`}
        </span>
      </div>
      <table className="mt-3 w-full text-body-sm">
        <thead>
          <tr className="text-left text-label-mono uppercase tracking-widest text-on-surface-variant/70">
            <th className="py-1 font-medium">Item</th>
            <th className="py-1 font-medium">Type</th>
            <th className="py-1 font-medium text-right">Value</th>
            <th className="py-1 font-medium">Cadence</th>
            <th className="py-1 font-medium">Convertible</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {pkg.items.map((i) => (
            <tr key={i.id} className="border-t border-outline-variant/50">
              <td className="py-1.5 text-on-surface">{i.label}</td>
              <td className="py-1.5 text-on-surface-variant">{i.type.toLowerCase().replace(/_/g, " ")}</td>
              <td className="py-1.5 text-right text-on-surface">{itemAmount(i)}</td>
              <td className="py-1.5 text-on-surface-variant">{i.cadence.toLowerCase()}</td>
              <td className="py-1.5 text-on-surface-variant">{i.convertible ? "yes" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const user = await requireSession();
  if (user.role !== "ADMIN") notFound();

  const { id } = await params;
  const employee = await getEmployee(user.tenantId, id);
  if (!employee) notFound();

  const history = employee.packages.filter((p) => p.supersededAt !== null);
  const [convertible, conversions, eligibility, advances] = await Promise.all([
    listConvertibleItems(user.tenantId, id),
    listConversions(user.tenantId, id),
    computeEligibility(user.tenantId, id),
    listAdvances(user.tenantId, id),
  ]);
  const csrfToken = (await cookies()).get(CSRF_COOKIE_NAME)?.value ?? "";

  return (
    <div className="flex flex-col gap-stack-lg">
      <div>
        <Link
          href={"/employees" as Route}
          className="inline-flex items-center gap-1 text-body-sm text-on-surface-variant hover:text-primary"
        >
          <Icon name="arrow_back" className="text-[16px]" />
          Employees
        </Link>
        <h1 className="mt-2 font-geist text-headline-lg text-on-surface">{employee.name}</h1>
        <p className="mt-1 text-body-md text-on-surface-variant">
          {employee.email} · {employee.role?.title ?? "no role"} · started {employee.startDate.slice(0, 10)} ·{" "}
          {employee.status.toLowerCase().replace("_", " ")}
        </p>
      </div>

      <section className="flex flex-col gap-stack-md">
        <h2 className="font-geist text-headline-sm text-on-surface">Current package</h2>
        {employee.currentPackage ? (
          <PackageCard pkg={employee.currentPackage} current />
        ) : (
          <p className="text-body-sm text-on-surface-variant">No active package.</p>
        )}
      </section>

      <AdvancePanel
        employeeId={employee.id}
        eligibility={eligibility}
        advances={advances}
        csrfToken={csrfToken}
      />

      <ConversionPanel
        employeeId={employee.id}
        items={convertible}
        conversions={conversions}
        csrfToken={csrfToken}
      />

      {history.length > 0 && (
        <section className="flex flex-col gap-stack-md">
          <h2 className="font-geist text-headline-sm text-on-surface">Package history</h2>
          {history.map((p) => (
            <PackageCard key={p.id} pkg={p} current={false} />
          ))}
        </section>
      )}
    </div>
  );
}
