-- CreateEnum
CREATE TYPE "AdvanceStatus" AS ENUM ('REQUESTED', 'APPROVED', 'DISBURSED', 'REPAID', 'REJECTED');

-- CreateTable
CREATE TABLE "AdvancePolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "maxPercentAccrued" DECIMAL(5,2) NOT NULL DEFAULT 50,
    "perCycleCap" DECIMAL(38,8),
    "feePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "autoApproveUnder" DECIMAL(38,8),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdvancePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryAdvance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amount" DECIMAL(38,8) NOT NULL,
    "fee" DECIMAL(38,8) NOT NULL,
    "outstanding" DECIMAL(38,8) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XLM',
    "status" "AdvanceStatus" NOT NULL DEFAULT 'REQUESTED',
    "paymentId" TEXT,
    "repaidByPaymentId" TEXT,
    "createdByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "disbursedAt" TIMESTAMP(3),
    "repaidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdvancePolicy_tenantId_key" ON "AdvancePolicy"("tenantId");

-- CreateIndex
CREATE INDEX "SalaryAdvance_tenantId_idx" ON "SalaryAdvance"("tenantId");

-- CreateIndex
CREATE INDEX "SalaryAdvance_employeeId_status_idx" ON "SalaryAdvance"("employeeId", "status");
