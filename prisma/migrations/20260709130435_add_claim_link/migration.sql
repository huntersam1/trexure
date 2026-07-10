-- CreateTable
CREATE TABLE "ClaimLink" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "encryptedNote" BYTEA NOT NULL,
    "noteNonce" BYTEA NOT NULL,
    "email" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "providerRef" TEXT,
    "revealedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClaimLink_paymentId_key" ON "ClaimLink"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimLink_tokenHash_key" ON "ClaimLink"("tokenHash");

-- CreateIndex
CREATE INDEX "ClaimLink_paymentId_idx" ON "ClaimLink"("paymentId");

-- AddForeignKey
ALTER TABLE "ClaimLink" ADD CONSTRAINT "ClaimLink_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
