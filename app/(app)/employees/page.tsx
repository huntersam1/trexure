import "server-only";
import type { JSX } from "react";
import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireSession } from "@/lib/auth/session";
import { listEmployees } from "@/lib/hr/employees";
import { Icon } from "@/components/ui/Icon";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  ACTIVE: "bg-primary/15 text-primary",
  ON_LEAVE: "bg-surface-container-highest text-on-surface-variant",
  TERMINATED: "bg-error/15 text-error",
};

function baseSalary(items: { type: string; amount: string | null; currency: string | null }[]): string {
  const base = items.find((i) => i.type === "BASE_SALARY");
  return base?.amount ? `${base.amount} ${base.currency ?? ""}`.trim() : "—";
}

export default async function EmployeesPage(): Promise<JSX.Element> {
  const user = await requireSession();
  if (user.role !== "ADMIN") notFound();

  const employees = await listEmployees(user.tenantId);

  return (
    <div className="flex flex-col gap-stack-lg">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-geist text-headline-lg text-on-surface">Employees</h1>
          <p className="mt-1 text-body-md text-on-surface-variant max-w-prose">
            Define each employee&rsquo;s role, salary, and compensation package. This is the foundation payroll,
            salary advances, and benefit conversions read from.
          </p>
        </div>
        <Link
          href={"/employees/new" as Route}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-body-sm font-medium text-on-primary hover:opacity-90"
        >
          <Icon name="person_add" className="text-[18px]" />
          Onboard employee
        </Link>
      </div>

      <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
        <div className="overflow-x-auto trx-scroll">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="text-left text-label-mono uppercase tracking-widest text-on-surface-variant/70">
                <th className="px-5 py-2 font-medium">Name</th>
                <th className="px-5 py-2 font-medium">Role</th>
                <th className="px-5 py-2 font-medium">Base salary</th>
                <th className="px-5 py-2 font-medium">Status</th>
                <th className="px-5 py-2 font-medium">Package items</th>
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr>
                  <td className="px-5 py-4 text-on-surface-variant" colSpan={5}>
                    No employees yet. Onboard your first one to get started.
                  </td>
                </tr>
              ) : (
                employees.map((e) => (
                  <tr key={e.id} className="border-t border-outline-variant/60">
                    <td className="px-5 py-2.5">
                      <Link href={`/employees/${e.id}` as Route} className="text-on-surface hover:text-primary font-medium">
                        {e.name}
                      </Link>
                      <span className="block text-label-mono text-on-surface-variant/70">{e.email}</span>
                    </td>
                    <td className="px-5 py-2.5 text-on-surface-variant">{e.role?.title ?? "—"}</td>
                    <td className="px-5 py-2.5 font-mono text-on-surface">
                      {e.currentPackage ? baseSalary(e.currentPackage.items) : "—"}
                    </td>
                    <td className="px-5 py-2.5">
                      <span className={`rounded-full px-2.5 py-1 text-label-mono font-bold ${STATUS_TONE[e.status] ?? ""}`}>
                        {e.status.toLowerCase().replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-on-surface-variant">{e.currentPackage?.items.length ?? 0}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
