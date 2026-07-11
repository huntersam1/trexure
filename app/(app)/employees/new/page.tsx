import "server-only";
import type { JSX } from "react";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { requireSession } from "@/lib/auth/session";
import { listRoles } from "@/lib/hr/employees";
import { CSRF_COOKIE_NAME } from "@/lib/auth/csrf";
import { OnboardForm } from "./OnboardForm";

export const dynamic = "force-dynamic";

export default async function NewEmployeePage(): Promise<JSX.Element> {
  const user = await requireSession();
  if (user.role !== "ADMIN") notFound();

  const roles = await listRoles(user.tenantId);
  const csrfToken = (await cookies()).get(CSRF_COOKIE_NAME)?.value ?? "";

  return <OnboardForm roles={roles} csrfToken={csrfToken} />;
}
