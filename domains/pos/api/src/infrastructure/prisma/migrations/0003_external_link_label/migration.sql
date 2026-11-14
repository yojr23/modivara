-- Etiqueta legible del recurso externo al vincular (copia para mostrar en la venta y el historial). Las ventas ya vinculadas quedan sin etiqueta.
-- AlterTable
ALTER TABLE "sale_external_links" ADD COLUMN     "label" VARCHAR(60);

-- ===== SQL explícito (DATA-001): índices parciales/por expresión, CHECK, defaults que Prisma no expresa =====
