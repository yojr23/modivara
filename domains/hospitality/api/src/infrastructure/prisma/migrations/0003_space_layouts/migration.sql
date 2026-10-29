-- CreateEnum
CREATE TYPE "layout_status" AS ENUM ('draft', 'published', 'archived');

-- CreateTable
CREATE TABLE "space_layouts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "zone_id" UUID,
    "version" INTEGER NOT NULL,
    "status" "layout_status" NOT NULL,
    "canvas_width" INTEGER NOT NULL,
    "canvas_height" INTEGER NOT NULL,
    "elements" JSONB NOT NULL,
    "revision" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_by" UUID,
    "published_at" TIMESTAMPTZ,
    "published_by" UUID,

    CONSTRAINT "space_layouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_space_layouts_draft" ON "space_layouts"("location_id", "zone_id") NULLS NOT DISTINCT WHERE (status = 'draft'::layout_status);

-- CreateIndex
CREATE UNIQUE INDEX "uq_space_layouts_published" ON "space_layouts"("location_id", "zone_id") NULLS NOT DISTINCT WHERE (status = 'published'::layout_status);

-- CreateIndex
CREATE UNIQUE INDEX "uq_space_layouts_version" ON "space_layouts"("location_id", "zone_id", "version") NULLS NOT DISTINCT WHERE (status <> 'draft'::layout_status);

-- AddForeignKey
ALTER TABLE "space_layouts" ADD CONSTRAINT "space_layouts_zone_id_location_id_fkey" FOREIGN KEY ("zone_id", "location_id") REFERENCES "zones"("id", "location_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== SQL explícito (DATA-001): índices parciales/por expresión, CHECK, defaults que Prisma no expresa =====

-- Un solo borrador y un solo publicado por espacio (zone_id NULL cuenta como un espacio: el predeterminado del local);
-- las versiones no-borrador no se repiten (los archivados conservan su número). Los tres índices de arriba, con NULLS NOT DISTINCT.

-- Lienzo acotado; el borrador no tiene versión (0) y sí la tienen publicados y archivados; la revisión parte de 1.
ALTER TABLE "space_layouts" ADD CONSTRAINT "ck_space_layouts_canvas"
  CHECK ("canvas_width" BETWEEN 1 AND 10000 AND "canvas_height" BETWEEN 1 AND 10000);
ALTER TABLE "space_layouts" ADD CONSTRAINT "ck_space_layouts_version"
  CHECK ("revision" >= 1 AND (("status" = 'draft') = ("version" = 0)) AND "version" >= 0);
ALTER TABLE "space_layouts" ADD CONSTRAINT "ck_space_layouts_elements" CHECK (jsonb_typeof("elements") = 'array');

-- Publicado y archivado llevan fecha y autor de la publicación; el borrador, ninguno.
ALTER TABLE "space_layouts" ADD CONSTRAINT "ck_space_layouts_published"
  CHECK (("status" = 'draft') = ("published_at" IS NULL) AND ("published_at" IS NULL) = ("published_by" IS NULL));
