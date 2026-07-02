import type { JSX } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { SignupForm } from "./SignupForm";

export const dynamic = "force-dynamic";

export default async function SignupPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (user) redirect("/");

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-surface border border-outline-variant rounded-xl p-8 shadow-xl shadow-black/5">
        <div className="mb-8">
          <span className="font-geist text-headline-lg font-[800] tracking-tight text-on-surface">Trexure</span>
          <p className="mt-1 text-label-mono uppercase tracking-widest font-bold text-primary/70">Create your workspace</p>
          <p className="mt-3 text-body-sm text-on-surface-variant">
            Get an isolated tenant with its own view key and a sample shielded payment —
            run the full Demo Replay the moment you land.
          </p>
        </div>
        <SignupForm />
        <p className="mt-6 text-body-sm text-on-surface-variant">
          Already have an account?{" "}
          <Link href="/login" className="text-primary font-bold hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
