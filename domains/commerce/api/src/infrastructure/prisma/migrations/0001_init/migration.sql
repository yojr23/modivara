-- CreateEnum
CREATE TYPE "unit" AS ENUM ('unit', 'bottle', 'kg', 'g', 'l', 'ml');

-- CreateEnum
CREATE TYPE "movement_direction" AS ENUM ('in', 'out', 'adjust');

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "category" TEXT,
    "unit" "unit" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_by" UUID,
    "deactivated_at" TIMESTAMPTZ,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_locations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_by" UUID,
    "deactivated_at" TIMESTAMPTZ,

    CONSTRAINT "stock_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movement_reasons" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "direction" "movement_direction" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_by" UUID,
    "deactivated_at" TIMESTAMPTZ,

    CONSTRAINT "movement_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "stock_location_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("stock_location_id","product_id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "stock_location_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "direction" "movement_direction" NOT NULL,
    "reason_id" UUID NOT NULL,
    "delta" DECIMAL(12,3) NOT NULL,
    "balance_after" DECIMAL(12,3) NOT NULL,
    "note" TEXT,
    "actor_user_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" UUID NOT NULL,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

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

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_products_id_location" ON "products"("id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_stock_locations_id_location" ON "stock_locations"("id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_movement_reasons_id_direction" ON "movement_reasons"("id", "direction");

-- CreateIndex
CREATE INDEX "ix_stock_movements_product" ON "stock_movements"("stock_location_id", "product_id", "occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_stock_movements_idempotency" ON "stock_movements"("organization_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "ix_outbox_pending" ON "outbox_events"("next_attempt_at") WHERE (dispatched_at IS NULL);

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_stock_location_id_location_id_fkey" FOREIGN KEY ("stock_location_id", "location_id") REFERENCES "stock_locations"("id", "location_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_product_id_location_id_fkey" FOREIGN KEY ("product_id", "location_id") REFERENCES "products"("id", "location_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stock_location_id_location_id_fkey" FOREIGN KEY ("stock_location_id", "location_id") REFERENCES "stock_locations"("id", "location_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_location_id_fkey" FOREIGN KEY ("product_id", "location_id") REFERENCES "products"("id", "location_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reason_id_direction_fkey" FOREIGN KEY ("reason_id", "direction") REFERENCES "movement_reasons"("id", "direction") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== SQL explícito (DATA-001): índices parciales/por expresión, CHECK, defaults que Prisma no expresa =====

-- Nombre y SKU únicos solo entre productos activos del local; el nombre sin distinguir mayúsculas.
CREATE UNIQUE INDEX "uq_products_name" ON "products" ("location_id", lower("name")) WHERE "deactivated_at" IS NULL;
CREATE UNIQUE INDEX "uq_products_sku" ON "products" ("location_id", "sku") WHERE "sku" IS NOT NULL AND "deactivated_at" IS NULL;

-- Nombre de lugar de stock único entre activos del local; un solo predeterminado activo por local.
CREATE UNIQUE INDEX "uq_stock_locations_name" ON "stock_locations" ("location_id", lower("name")) WHERE "deactivated_at" IS NULL;
CREATE UNIQUE INDEX "uq_stock_locations_default" ON "stock_locations" ("location_id") WHERE "is_default" AND "deactivated_at" IS NULL;

-- Motivos por negocio: nombre único entre activos.
CREATE UNIQUE INDEX "uq_movement_reasons_name" ON "movement_reasons" ("organization_id", lower("name")) WHERE "deactivated_at" IS NULL;

-- ponytail: sin saldos negativos (provisional, TECH-001 §16.8). Si cambia, quitar este CHECK y la guarda de StockBalance.
ALTER TABLE "stock_balances" ADD CONSTRAINT "ck_stock_balances_quantity" CHECK ("quantity" >= 0);

-- El signo de delta lo fija la dirección: entrada > 0, salida < 0, ajuste ≠ 0.
ALTER TABLE "stock_movements" ADD CONSTRAINT "ck_stock_movements_delta" CHECK (
  ("direction" = 'in'     AND "delta" > 0) OR
  ("direction" = 'out'    AND "delta" < 0) OR
  ("direction" = 'adjust' AND "delta" <> 0)
);
