"use server";

import { redirect } from "next/navigation";

import { destroyReceiverSession } from "@/lib/receiver/session";

export async function receiverLogoutAction(): Promise<void> {
  await destroyReceiverSession();
  redirect("/claim/login");
}
