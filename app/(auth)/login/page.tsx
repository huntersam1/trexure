import type { JSX } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { Logo } from "@/components/ui/Logo";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (user) redirect("/");

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-surface border border-outline-variant rounded-xl p-8 shadow-xl shadow-black/5">
        <div className="mb-8">
          <Logo />
          <p className="mt-3 text-label-mono uppercase tracking-widest font-bold text-primary/70">Treasury Ops Console</p>
        </div>
        <LoginForm />
        <p className="mt-6 text-body-sm text-on-surface-variant">
          New to Trexure?{" "}
          <Link href="/signup" className="text-primary font-bold hover:underline">
            Create a workspace
          </Link>
        </p>
      </div>
    </div>
  );
}
