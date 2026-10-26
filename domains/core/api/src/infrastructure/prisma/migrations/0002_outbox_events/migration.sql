-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "event_type" TEXT NOT NULL,
    "event_version" INTEGER NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "correlation_id" UUID NOT NULL,
    "causation_id" UUID,
    "payload" JSONB NOT NULL,
    "dispatched_at" TIMESTAMPTZ,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failed_at" TIMESTAMPTZ,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_outbox_pending" ON "outbox_events"("next_attempt_at") WHERE (dispatched_at IS NULL AND failed_at IS NULL);

-- ===== SQL explícito (DATA-001): índices parciales/por expresión, CHECK, defaults que Prisma no expresa =====
