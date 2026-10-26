-- DropIndex
DROP INDEX "ix_outbox_pending";

-- AlterTable
ALTER TABLE "outbox_events" ADD COLUMN     "failed_at" TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX "ix_outbox_pending" ON "outbox_events"("next_attempt_at") WHERE (dispatched_at IS NULL AND failed_at IS NULL);

-- ===== SQL explícito (DATA-001): índices parciales/por expresión, CHECK, defaults que Prisma no expresa =====
