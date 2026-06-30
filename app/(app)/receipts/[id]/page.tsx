import "server-only";
import type { JSX } from "react";
import { notFound } from "next/navigation";
import { getReceiptJson } from "@/lib/data/payments";
import { ReceiptActions } from "./ReceiptActions";

export const dynamic = "force-dynamic";

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params; // id == paymentId
  const receipt = await getReceiptJson(id);
  if (!receipt) notFound();

  return (
    <div className="flex flex-col gap-stack-lg items-center">
      <div className="w-full max-w-md">
        <h1 className="font-geist text-headline-lg text-on-surface">Receipt</h1>
        <p className="mt-1 text-body-md text-on-surface-variant">Shareable, accounting-ready settlement record.</p>
      </div>
      <ReceiptActions receipt={receipt} />
    </div>
  );
}
