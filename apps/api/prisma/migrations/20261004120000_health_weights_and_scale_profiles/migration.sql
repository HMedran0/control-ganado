-- M6: sanidad, pesos y báscula.
--
-- 1. `weight_records`: cómo se identificó al animal (`identified_by`, nulo si nadie lo
--    identificó) y de dónde salió el peso (`weight_source`), para el informe del piloto (PIL-05);
--    y el número de serie del indicador del pesaje en vivo (PES-03, M15).
-- 2. `treatment_records.expense_id`: el gasto del costo del tratamiento (SAN-05, solo ADMIN).
-- 3. `import_batches`: `kind` y `work_session_id`, para que la importación de la báscula (PES-04)
--    use la misma clave de idempotencia y la misma huella del archivo que la del inventario
--    (ADR-011).
-- 4. `scale_profiles`: perfiles de báscula de la finca, con el nombre único sin distinguir
--    mayúsculas y `updated_at` con el trigger `set_updated_at()` (ADR-012).

-- CreateEnum
CREATE TYPE "IdentifiedBy" AS ENUM ('RFID_READER', 'QR', 'SEARCH', 'IMPORT');

-- CreateEnum
CREATE TYPE "WeightSource" AS ENUM ('MANUAL', 'SCALE_FILE', 'SCALE_LIVE');

-- CreateEnum
CREATE TYPE "ScaleFileFormat" AS ENUM ('CSV', 'XLSX');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('ANIMALS', 'WEIGHTS');

-- AlterTable
ALTER TABLE "import_batches" ADD COLUMN     "kind" "ImportKind" NOT NULL DEFAULT 'ANIMALS',
ADD COLUMN     "work_session_id" UUID;

-- AlterTable
ALTER TABLE "treatment_records" ADD COLUMN     "expense_id" UUID;

-- AlterTable
ALTER TABLE "weight_records" ADD COLUMN     "identified_by" "IdentifiedBy",
ADD COLUMN     "scale_serial" TEXT,
ADD COLUMN     "weight_source" "WeightSource" NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "scale_profiles" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "file_format" "ScaleFileFormat" NOT NULL,
    "column_mapping" JSONB NOT NULL,
    "source_template_key" TEXT,
    "source_template_version" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scale_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scale_profiles_farm_id_updated_at_idx" ON "scale_profiles"("farm_id", "updated_at");

-- AddForeignKey
ALTER TABLE "treatment_records" ADD CONSTRAINT "treatment_records_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_work_session_id_fkey" FOREIGN KEY ("work_session_id") REFERENCES "work_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scale_profiles" ADD CONSTRAINT "scale_profiles_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Nombre único por finca sin distinguir mayúsculas, como los catálogos (M3).
CREATE UNIQUE INDEX "scale_profiles_farm_id_lower_name_key"
  ON "scale_profiles" ("farm_id", lower("name"));

CREATE TRIGGER "scale_profiles_set_updated_at"
  BEFORE UPDATE ON "scale_profiles"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Un pesaje de un archivo de la báscula o en vivo siempre sabe cómo se identificó al animal.
ALTER TABLE "weight_records" ADD CONSTRAINT "weight_records_scale_identified_ck"
  CHECK ("weight_source" = 'MANUAL' OR "identified_by" IS NOT NULL);

CREATE INDEX "import_batches_work_session_id_idx" ON "import_batches" ("work_session_id");
