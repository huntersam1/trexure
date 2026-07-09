"use server";

import { redirect } from "next/navigation";

import { destroySession } from "@/lib/auth/session";

/**
 * Tenant sign-out (#115). Mirrors the receiver `receiverLogoutAction`: a server
 * action (Next builds in origin/CSRF protection for these) that clears the
 * session cookie + DB row, then sends the user to /login. Wired to the Sidebar
 * footer via a `<form action={logoutAction}>` so it works without JS.
 */
export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}
