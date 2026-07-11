-- CreateEnum
CREATE TYPE "ConversionStatus" AS ENUM ('REQUESTED', 'APPROVED', 'DISBURSED', 'REJECTED');

-- AlterTable
ALTER TABLE "PackageItem" ADD COLUMN     "convertedValue" DECIMAL(38,8) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ConversionPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ratePercent" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "feePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "perConversionCap" DECIMAL(38,8),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageConversion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "packageItemId" TEXT NOT NULL,
    "notionalAmount" DECIMAL(38,8) NOT NULL,
    "cashValue" DECIMAL(38,8) NOT NULL,
    "fee" DECIMAL(38,8) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XLM',
    "status" "ConversionStatus" NOT NULL DEFAULT 'REQUESTED',
    "paymentId" TEXT,
    "createdByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "disbursedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackageConversion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConversionPolicy_tenantId_key" ON "ConversionPolicy"("tenantId");

-- CreateIndex
CREATE INDEX "PackageConversion_tenantId_idx" ON "PackageConversion"("tenantId");

-- CreateIndex
CREATE INDEX "PackageConversion_employeeId_status_idx" ON "PackageConversion"("employeeId", "status");

-- CreateIndex
CREATE INDEX "PackageConversion_packageItemId_idx" ON "PackageConversion"("packageItemId");

-- AddForeignKey
ALTER TABLE "PackageConversion" ADD CONSTRAINT "PackageConversion_packageItemId_fkey" FOREIGN KEY ("packageItemId") REFERENCES "PackageItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
