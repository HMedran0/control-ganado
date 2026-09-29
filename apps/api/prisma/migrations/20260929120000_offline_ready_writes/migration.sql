-- Escrituras listas para trabajar sin conexión (ADR-012, tarea de M5).
--
-- 1. `updated_at` en toda tabla que se sincronizará (animales, identificadores, etiquetas del
--    animal, catálogos, configuración, eventos y jornadas), mantenido por el trigger
--    `set_updated_at()` en cada UPDATE: también las escrituras con SQL directo (clasificación,
--    códigos, importación en lote) lo cambian. Prisma ya no lo escribe (`@updatedAt` retirado).
--    Índice (farm_id, updated_at) para la sincronización (SYN-01, fase 2).
-- 2. `animal_tags` deja de borrarse: quitar una etiqueta marca `removed_at` y `removed_by_id`.
--    La tabla gana `id` (UUIDv7) y `farm_id`; una etiqueta vigente es única por animal.
-- 3. `idempotency_keys`: respuestas de las acciones con encabezado `Idempotency-Key`.

-- ---------------------------------------------------------------------------------------------
-- 1. Función del trigger
-- ---------------------------------------------------------------------------------------------

-- `now()` es el instante en que empezó la transacción: todas las filas que cambia una misma
-- transacción quedan con la misma marca.
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. Columnas nuevas. Las filas existentes toman su `created_at` cuando la tabla lo tiene; los
--    catálogos no lo tienen y quedan con el instante de la migración.
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "animals" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "farms" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "pregnancies" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "breeds" ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "vaccines" ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "lots" ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "tags" ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "vaccination_cycles" ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "identifiers" ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "vaccination_records" ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "treatment_records" ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "weight_records" ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "lot_movements" ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "work_sessions" ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "expenses" ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "expense_allocations" ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "sales" ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "valuations" ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "vaccination_cycles" SET "updated_at" = "created_at";
UPDATE "identifiers" SET "updated_at" = "created_at";
UPDATE "vaccination_records" SET "updated_at" = COALESCE("voided_at", "created_at");
UPDATE "treatment_records" SET "updated_at" = COALESCE("voided_at", "created_at");
UPDATE "weight_records" SET "updated_at" = COALESCE("voided_at", "created_at");
UPDATE "lot_movements" SET "updated_at" = "created_at";
UPDATE "work_sessions" SET "updated_at" = COALESCE("closed_at", "created_at");
UPDATE "expenses" SET "updated_at" = COALESCE("voided_at", "created_at");
UPDATE "expense_allocations" AS a SET "updated_at" = e."created_at"
  FROM "expenses" AS e WHERE e."id" = a."expense_id";
UPDATE "sales" SET "updated_at" = COALESCE("voided_at", "created_at");
UPDATE "valuations" SET "updated_at" = "created_at";

-- ---------------------------------------------------------------------------------------------
-- 3. animal_tags: id, finca y baja lógica
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "animal_tags"
  ADD COLUMN "id" UUID,
  ADD COLUMN "farm_id" UUID,
  ADD COLUMN "removed_at" TIMESTAMPTZ,
  ADD COLUMN "removed_by_id" UUID,
  ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- UUIDv7 con la marca de tiempo de `created_at` (los 48 bits altos) y el resto aleatorio, como
-- los que genera la aplicación (packages/shared/src/id.ts). Solo para las filas existentes.
UPDATE "animal_tags" AS at
SET "id" = encode(
      set_bit(
        set_bit(
          overlay(uuid_send(gen_random_uuid())
                  PLACING substring(int8send(floor(extract(epoch FROM at."created_at") * 1000)::bigint) FROM 3)
                  FROM 1 FOR 6),
          52, 1),
        53, 1),
      'hex')::uuid,
    "farm_id" = a."farm_id",
    "updated_at" = at."created_at"
FROM "animals" AS a
WHERE a."id" = at."animal_id";

ALTER TABLE "animal_tags"
  ALTER COLUMN "id" SET NOT NULL,
  ALTER COLUMN "farm_id" SET NOT NULL,
  DROP CONSTRAINT "animal_tags_pkey",
  ADD CONSTRAINT "animal_tags_pkey" PRIMARY KEY ("id"),
  ADD CONSTRAINT "animal_tags_removed_ck"
    CHECK (("removed_at" IS NULL) = ("removed_by_id" IS NULL));

ALTER TABLE "animal_tags" ADD CONSTRAINT "animal_tags_farm_id_fkey"
  FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Una etiqueta vigente es única por animal; las quitadas se conservan como historial.
CREATE UNIQUE INDEX "animal_tags_active_uq" ON "animal_tags"("animal_id", "tag_id")
  WHERE "removed_at" IS NULL;
CREATE INDEX "animal_tags_animal_id_idx" ON "animal_tags"("animal_id");

-- ---------------------------------------------------------------------------------------------
-- 4. idempotency_keys
-- ---------------------------------------------------------------------------------------------

CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "key" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idempotency_keys_farm_id_key_key" ON "idempotency_keys"("farm_id", "key");
CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys"("created_at");

ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_farm_id_fkey"
  FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- 5. Índices (farm_id, updated_at) y triggers. Los triggers se crean al final para que el
--    relleno de arriba no los dispare.
-- ---------------------------------------------------------------------------------------------

CREATE INDEX "animals_farm_id_updated_at_idx" ON "animals"("farm_id", "updated_at");
CREATE INDEX "animal_tags_farm_id_updated_at_idx" ON "animal_tags"("farm_id", "updated_at");
CREATE INDEX "identifiers_farm_id_updated_at_idx" ON "identifiers"("farm_id", "updated_at");
CREATE INDEX "breeds_farm_id_updated_at_idx" ON "breeds"("farm_id", "updated_at");
CREATE INDEX "vaccines_farm_id_updated_at_idx" ON "vaccines"("farm_id", "updated_at");
CREATE INDEX "lots_farm_id_updated_at_idx" ON "lots"("farm_id", "updated_at");
CREATE INDEX "tags_farm_id_updated_at_idx" ON "tags"("farm_id", "updated_at");
CREATE INDEX "vaccination_cycles_farm_id_updated_at_idx" ON "vaccination_cycles"("farm_id", "updated_at");
CREATE INDEX "pregnancies_farm_id_updated_at_idx" ON "pregnancies"("farm_id", "updated_at");
CREATE INDEX "vaccination_records_farm_id_updated_at_idx" ON "vaccination_records"("farm_id", "updated_at");
CREATE INDEX "treatment_records_farm_id_updated_at_idx" ON "treatment_records"("farm_id", "updated_at");
CREATE INDEX "weight_records_farm_id_updated_at_idx" ON "weight_records"("farm_id", "updated_at");
CREATE INDEX "lot_movements_farm_id_updated_at_idx" ON "lot_movements"("farm_id", "updated_at");
CREATE INDEX "work_sessions_farm_id_updated_at_idx" ON "work_sessions"("farm_id", "updated_at");
CREATE INDEX "expenses_farm_id_updated_at_idx" ON "expenses"("farm_id", "updated_at");
CREATE INDEX "expense_allocations_farm_id_updated_at_idx" ON "expense_allocations"("farm_id", "updated_at");
CREATE INDEX "sales_farm_id_updated_at_idx" ON "sales"("farm_id", "updated_at");
CREATE INDEX "valuations_farm_id_updated_at_idx" ON "valuations"("farm_id", "updated_at");

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'farms', 'animals', 'animal_tags', 'identifiers', 'breeds', 'vaccines', 'lots', 'tags',
    'vaccination_cycles', 'pregnancies', 'vaccination_records', 'treatment_records',
    'weight_records', 'lot_movements', 'work_sessions', 'expenses', 'expense_allocations',
    'sales', 'valuations'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t || '_set_updated_at', t);
  END LOOP;
END;
$$;
