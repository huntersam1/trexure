-- CreateEnum
CREATE TYPE "YieldStatus" AS ENUM ('PENDING', 'SWEPT_IN', 'SWEPT_OUT', 'UNWOUND', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentStatus" ADD VALUE 'SWEPT_IN';
ALTER TYPE "PaymentStatus" ADD VALUE 'SWEPT_OUT';

-- CreateTable
CREATE TABLE "YieldConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "yieldAsset" TEXT NOT NULL DEFAULT 'YLDS',
    "minIdleBuffer" DECIMAL(38,8) NOT NULL DEFAULT 0,
    "sweepThreshold" DECIMAL(38,8) NOT NULL DEFAULT 0,
    "feeBps" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YieldConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YieldPosition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "status" "YieldStatus" NOT NULL DEFAULT 'PENDING',
    "yieldAsset" TEXT NOT NULL DEFAULT 'YLDS',
    "principal" DECIMAL(38,8) NOT NULL,
    "sweptInAmount" DECIMAL(38,8),
    "sweptOutAmount" DECIMAL(38,8),
    "accruedYield" DECIMAL(38,8) NOT NULL DEFAULT 0,
    "feeBps" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "feeAmount" DECIMAL(38,8) NOT NULL DEFAULT 0,
    "sweepInTxHash" TEXT,
    "sweepInLedger" INTEGER,
    "sweepOutTxHash" TEXT,
    "sweepOutLedger" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YieldPosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "YieldConfig_tenantId_key" ON "YieldConfig"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "YieldPosition_paymentId_key" ON "YieldPosition"("paymentId");

-- CreateIndex
CREATE INDEX "YieldPosition_tenantId_status_idx" ON "YieldPosition"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "YieldConfig" ADD CONSTRAINT "YieldConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YieldPosition" ADD CONSTRAINT "YieldPosition_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YieldPosition" ADD CONSTRAINT "YieldPosition_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
