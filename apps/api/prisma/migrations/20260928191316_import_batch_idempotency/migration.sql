-- Importación del inventario (ANI-09, M4d; ADR-011).
--
-- `idempotency_key`: la web la genera al elegir el archivo y la manda al confirmar; un doble clic
-- o un reintento con la misma clave devuelve el lote ya creado (índice único por finca).
-- `file_sha256`: con él la simulación avisa si el mismo archivo ya se importó.
-- Hasta M4d no había importaciones; por si acaso, las filas que existan toman su propio id como
-- clave y un hash vacío.

ALTER TYPE "AuditAction" ADD VALUE 'IMPORT';

ALTER TABLE "import_batches"
  ADD COLUMN "file_sha256" TEXT,
  ADD COLUMN "idempotency_key" UUID;

UPDATE "import_batches" SET "file_sha256" = '', "idempotency_key" = "id";

ALTER TABLE "import_batches"
  ALTER COLUMN "file_sha256" SET NOT NULL,
  ALTER COLUMN "idempotency_key" SET NOT NULL;

CREATE INDEX "import_batches_farm_id_file_sha256_idx" ON "import_batches"("farm_id", "file_sha256");

CREATE UNIQUE INDEX "import_batches_farm_id_idempotency_key_key" ON "import_batches"("farm_id", "idempotency_key");
