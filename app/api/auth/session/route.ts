import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { problem } from "@/lib/http/problem";

export async function GET(): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return problem(401, "Unauthorized", "No active session.");
  return NextResponse.json({ user });
}
