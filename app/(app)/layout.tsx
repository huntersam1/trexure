import "server-only";
import type { JSX, ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { AppShell } from "@/components/shell/AppShell";
import { logoutAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <AppShell
      username={user.username}
      role={user.role}
      newPaymentsEnabled={env.ENABLE_NEW_PAYMENTS}
      poolRailEnabled={env.ENABLE_POOL_RAIL}
      yieldEnabled={env.ENABLE_YIELD}
      onLogout={logoutAction}
    >
      {children}
    </AppShell>
  );
}
