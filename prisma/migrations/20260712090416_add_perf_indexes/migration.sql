-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_paymentId_idx" ON "Notification"("paymentId");

-- CreateIndex
CREATE INDEX "Payment_poolCommitment_idx" ON "Payment"("poolCommitment");

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_createdAt_idx" ON "WebhookEvent"("provider", "createdAt");
