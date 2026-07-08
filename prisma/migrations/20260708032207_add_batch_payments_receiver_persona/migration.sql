-- CreateEnum
CREATE TYPE "PayoutMethod" AS ENUM ('POOL_WALLET', 'POOL_BANK');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "batchId" TEXT,
ADD COLUMN     "encryptedNote" BYTEA,
ADD COLUMN     "noteNonce" BYTEA,
ADD COLUMN     "payoutMethod" "PayoutMethod",
ADD COLUMN     "poolCommitment" TEXT,
ADD COLUMN     "poolNullifierHash" TEXT,
ADD COLUMN     "receiverId" TEXT;

-- CreateTable
CREATE TABLE "Receiver" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Receiver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiverSession" (
    "id" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "ReceiverSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "totalSourceAmount" DECIMAL(38,8) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Receiver_email_key" ON "Receiver"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiverSession_tokenHash_key" ON "ReceiverSession"("tokenHash");

-- CreateIndex
CREATE INDEX "ReceiverSession_receiverId_idx" ON "ReceiverSession"("receiverId");

-- CreateIndex
CREATE INDEX "PaymentBatch_tenantId_createdAt_idx" ON "PaymentBatch"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_batchId_idx" ON "Payment"("batchId");

-- CreateIndex
CREATE INDEX "Payment_receiverId_idx" ON "Payment"("receiverId");

-- AddForeignKey
ALTER TABLE "ReceiverSession" ADD CONSTRAINT "ReceiverSession_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "Receiver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentBatch" ADD CONSTRAINT "PaymentBatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentBatch" ADD CONSTRAINT "PaymentBatch_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PaymentBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "Receiver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
