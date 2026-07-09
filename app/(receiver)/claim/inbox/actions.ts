"use server";

import { revalidatePath } from "next/cache";

import { requireReceiver } from "@/lib/receiver/session";
import { markAllReadForReceiver } from "@/lib/receiver/notifications";

/**
 * Mark all of the signed-in receiver's notifications read (#82). Server action
 * behind the inbox "Mark all read" form — receiver-scoped via requireReceiver,
 * so it only ever touches the caller's own rows.
 */
export async function markAllReadAction(): Promise<void> {
  const receiver = await requireReceiver();
  await markAllReadForReceiver(receiver.id);
  revalidatePath("/claim/inbox");
}
