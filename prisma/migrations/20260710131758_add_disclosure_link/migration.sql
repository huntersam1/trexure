-- CreateTable
CREATE TABLE "DisclosureLink" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisclosureLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DisclosureLink_paymentId_key" ON "DisclosureLink"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "DisclosureLink_tokenHash_key" ON "DisclosureLink"("tokenHash");

-- CreateIndex
CREATE INDEX "DisclosureLink_tenantId_createdAt_idx" ON "DisclosureLink"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "DisclosureLink" ADD CONSTRAINT "DisclosureLink_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
