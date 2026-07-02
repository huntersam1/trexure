import "server-only";
import type { JSX, ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { Sidebar } from "@/components/shell/Sidebar";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="h-screen overflow-hidden flex bg-background text-on-surface">
      <Sidebar username={user.username} role={user.role} newPaymentsEnabled={env.ENABLE_NEW_PAYMENTS} />
      <main className="flex-1 overflow-y-auto trx-scroll">
        <div className="mx-auto w-full max-w-[1280px] p-margin-desktop">{children}</div>
      </main>
    </div>
  );
}
