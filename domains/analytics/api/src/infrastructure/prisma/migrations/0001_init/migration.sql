-- CreateTable
CREATE TABLE "processed_events" (
    "event_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "processed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "service_call_facts" (
    "service_call_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "table_id" UUID NOT NULL,
    "table_label" TEXT NOT NULL,
    "zone_id" UUID,
    "zone_name" TEXT,
    "call_type" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,
    "acknowledged_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "press_count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "service_call_facts_pkey" PRIMARY KEY ("service_call_id")
);

-- CreateTable
CREATE TABLE "stock_movement_facts" (
    "movement_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "stock_location_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "reason_id" UUID NOT NULL,
    "reason_name" TEXT NOT NULL,
    "delta" DECIMAL(12,3) NOT NULL,
    "balance_after" DECIMAL(12,3) NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "stock_movement_facts_pkey" PRIMARY KEY ("movement_id")
);

-- CreateIndex
CREATE INDEX "ix_service_call_facts_period" ON "service_call_facts"("location_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_stock_movement_facts_period" ON "stock_movement_facts"("location_id", "occurred_at");

-- ===== SQL explícito (DATA-001): índices parciales/por expresión, CHECK, defaults que Prisma no expresa =====
