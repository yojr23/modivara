-- La etiqueta guarda «zona · mesa» íntegra (zona ≤60 + « · » + mesa ≤30 = 93); antes se recortaba a 60 y dos zonas podían colisionar.
-- AlterTable
ALTER TABLE "sale_external_links" ALTER COLUMN "label" TYPE VARCHAR(93);
