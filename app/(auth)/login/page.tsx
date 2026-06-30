import type { JSX } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (user) redirect("/");

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-surface border border-outline-variant rounded-xl p-8 shadow-xl shadow-black/5">
        <div className="mb-8">
          <span className="font-geist text-headline-lg font-[800] tracking-tight text-on-surface">Trexure</span>
          <p className="mt-1 text-label-mono uppercase tracking-widest font-bold text-primary/70">Treasury Ops Console</p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
