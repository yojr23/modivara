-- CreateEnum
CREATE TYPE "unit" AS ENUM ('unit', 'kg', 'g', 'l', 'ml', 'm', 'h');

-- CreateEnum
CREATE TYPE "sale_status" AS ENUM ('open', 'completed', 'voided');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('cash', 'card', 'transfer', 'other');

-- CreateTable
CREATE TABLE "location_settings" (
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "location_settings_pkey" PRIMARY KEY ("organization_id","location_id")
);

-- CreateTable
CREATE TABLE "sellable_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "category" TEXT,
    "unit" "unit" NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "deactivated_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "sellable_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "sale_status" NOT NULL,
    "payment_method" "payment_method",
    "opened_at" TIMESTAMPTZ NOT NULL,
    "opened_by" UUID NOT NULL,
    "closed_at" TIMESTAMPTZ,
    "closed_by" UUID,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_lines" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "sellable_item_id" UUID NOT NULL,
    "sku_snapshot" TEXT,
    "name_snapshot" TEXT NOT NULL,
    "unit_snapshot" "unit" NOT NULL,
    "unit_price_snapshot" DECIMAL(14,2) NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "added_at" TIMESTAMPTZ NOT NULL,
    "added_by" UUID NOT NULL,
    "voided_at" TIMESTAMPTZ,
    "voided_by" UUID,

    CONSTRAINT "sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_external_links" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID NOT NULL,
    "released_at" TIMESTAMPTZ,

    CONSTRAINT "sale_external_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "organization_id" UUID NOT NULL,
    "key" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "sale_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("organization_id","key")
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
    "failed_at" TIMESTAMPTZ,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_sellable_items_id_location" ON "sellable_items"("id", "location_id");

-- CreateIndex
CREATE INDEX "ix_sales_history" ON "sales"("location_id", "opened_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_sales_id_location" ON "sales"("id", "location_id");

-- CreateIndex
CREATE INDEX "ix_sale_lines_sale" ON "sale_lines"("sale_id");

-- CreateIndex
CREATE INDEX "ix_sale_external_links_sale" ON "sale_external_links"("sale_id");

-- CreateIndex
CREATE INDEX "ix_outbox_pending" ON "outbox_events"("next_attempt_at") WHERE (dispatched_at IS NULL AND failed_at IS NULL);

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_id_location_id_fkey" FOREIGN KEY ("sale_id", "location_id") REFERENCES "sales"("id", "location_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sellable_item_id_location_id_fkey" FOREIGN KEY ("sellable_item_id", "location_id") REFERENCES "sellable_items"("id", "location_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_external_links" ADD CONSTRAINT "sale_external_links_sale_id_location_id_fkey" FOREIGN KEY ("sale_id", "location_id") REFERENCES "sales"("id", "location_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== SQL explícito (DATA-001): índices parciales/por expresión, CHECK, defaults que Prisma no expresa =====

-- Nombre y SKU únicos solo entre artículos activos del local; el nombre sin distinguir mayúsculas.
CREATE UNIQUE INDEX "uq_sellable_items_name" ON "sellable_items" ("location_id", lower("name")) WHERE "deactivated_at" IS NULL;
CREATE UNIQUE INDEX "uq_sellable_items_sku" ON "sellable_items" ("location_id", "sku") WHERE "sku" IS NOT NULL AND "deactivated_at" IS NULL;

-- Un solo vínculo activo por recurso externo: dos aperturas simultáneas del mismo recurso no crean dos ventas.
CREATE UNIQUE INDEX "uq_sale_external_links_active" ON "sale_external_links" ("organization_id", "location_id", "provider", "resource_type", "resource_id") WHERE "active";
ALTER TABLE "sale_external_links" ADD CONSTRAINT "ck_sale_external_links_released" CHECK ("active" = ("released_at" IS NULL));

-- Moneda ISO 4217 (POS-001 §2.5).
ALTER TABLE "location_settings" ADD CONSTRAINT "ck_location_settings_currency" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "sellable_items" ADD CONSTRAINT "ck_sellable_items_currency" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "sales" ADD CONSTRAINT "ck_sales_currency" CHECK ("currency" ~ '^[A-Z]{3}$');

-- Precios no negativos (cortesías en 0) y cantidades positivas.
ALTER TABLE "sellable_items" ADD CONSTRAINT "ck_sellable_items_price" CHECK ("price" >= 0);
ALTER TABLE "sale_lines" ADD CONSTRAINT "ck_sale_lines_unit_price" CHECK ("unit_price_snapshot" >= 0);
ALTER TABLE "sale_lines" ADD CONSTRAINT "ck_sale_lines_quantity" CHECK ("quantity" > 0);
ALTER TABLE "sale_lines" ADD CONSTRAINT "ck_sale_lines_voided" CHECK (("voided_at" IS NULL) = ("voided_by" IS NULL));

-- Estado coherente: abierta ⇔ sin cierre; solo una venta cerrada tiene cobro declarado.
ALTER TABLE "sales" ADD CONSTRAINT "ck_sales_closed" CHECK (
  ("status" = 'open') = ("closed_at" IS NULL) AND ("closed_at" IS NULL) = ("closed_by" IS NULL)
);
ALTER TABLE "sales" ADD CONSTRAINT "ck_sales_payment_method" CHECK (("status" = 'completed') = ("payment_method" IS NOT NULL));
