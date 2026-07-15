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
        <div className="mt-6 rounded-lg border border-outline-variant bg-surface-container-low px-4 py-3">
          <p className="text-label-mono uppercase tracking-widest font-bold text-on-surface-variant/60">Test account</p>
          <dl className="mt-2 flex flex-col gap-1 text-body-sm text-on-surface-variant">
            <div className="flex items-baseline gap-2">
              <dt className="w-20 shrink-0 text-on-surface-variant/60">Username</dt>
              <dd className="font-mono text-on-surface">admintest</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="w-20 shrink-0 text-on-surface-variant/60">Password</dt>
              <dd className="font-mono text-on-surface break-all">qP4PeX51aw3OqN9a61U6s1LFM</dd>
            </div>
          </dl>
        </div>
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
