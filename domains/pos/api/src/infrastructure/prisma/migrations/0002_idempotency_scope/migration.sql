-- Una clave de idempotencia solo puede apuntar a una venta de su propio negocio (antes la FK era solo por sale_id).
-- DropForeignKey
ALTER TABLE "idempotency_keys" DROP CONSTRAINT "idempotency_keys_sale_id_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "uq_sales_id_organization" ON "sales"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_sale_id_organization_id_fkey" FOREIGN KEY ("sale_id", "organization_id") REFERENCES "sales"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== SQL explícito (DATA-001): índices parciales/por expresión, CHECK, defaults que Prisma no expresa =====
-- La unidad `unit` solo admite cantidades enteras (la app ya lo valida; la base lo garantiza).
ALTER TABLE "sale_lines" ADD CONSTRAINT "ck_sale_lines_whole_units" CHECK ("unit_snapshot" <> 'unit' OR "quantity" = trunc("quantity"));
