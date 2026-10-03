-- M6 (ADR-012): `vaccination_cycle_vaccines` deja de borrarse al editar un ciclo.
--
-- Quitar una vacuna de un ciclo marca `removed_at` y `removed_by_id`, como `animal_tags` desde
-- M5, para que la sincronización (SYN-01) lleve el cambio. La tabla gana `id` (UUIDv7), `farm_id`,
-- `created_at` y `updated_at` con el trigger `set_updated_at()`; una vacuna vigente es única por
-- ciclo con un índice único parcial.

ALTER TABLE "vaccination_cycle_vaccines"
  ADD COLUMN "id" UUID,
  ADD COLUMN "farm_id" UUID,
  ADD COLUMN "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "removed_at" TIMESTAMPTZ,
  ADD COLUMN "removed_by_id" UUID,
  ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Las filas existentes toman la creación del ciclo y un UUIDv7 con esa marca de tiempo (los 48
-- bits altos) y el resto aleatorio, como los que genera la aplicación (packages/shared/src/id.ts).
UPDATE "vaccination_cycle_vaccines" AS cv
SET "id" = encode(
      set_bit(
        set_bit(
          overlay(uuid_send(gen_random_uuid())
                  PLACING substring(int8send(floor(extract(epoch FROM c."created_at") * 1000)::bigint) FROM 3)
                  FROM 1 FOR 6),
          52, 1),
        53, 1),
      'hex')::uuid,
    "farm_id" = c."farm_id",
    "created_at" = c."created_at",
    "updated_at" = c."created_at"
FROM "vaccination_cycles" AS c
WHERE c."id" = cv."cycle_id";

ALTER TABLE "vaccination_cycle_vaccines"
  ALTER COLUMN "id" SET NOT NULL,
  ALTER COLUMN "farm_id" SET NOT NULL,
  DROP CONSTRAINT "vaccination_cycle_vaccines_pkey",
  ADD CONSTRAINT "vaccination_cycle_vaccines_pkey" PRIMARY KEY ("id"),
  ADD CONSTRAINT "vaccination_cycle_vaccines_removed_ck"
    CHECK (("removed_at" IS NULL) = ("removed_by_id" IS NULL));

ALTER TABLE "vaccination_cycle_vaccines" ADD CONSTRAINT "vaccination_cycle_vaccines_farm_id_fkey"
  FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Una vacuna vigente es única por ciclo; las quitadas se conservan como historial.
CREATE UNIQUE INDEX "vaccination_cycle_vaccines_active_uq"
  ON "vaccination_cycle_vaccines"("cycle_id", "vaccine_id")
  WHERE "removed_at" IS NULL;
CREATE INDEX "vaccination_cycle_vaccines_cycle_id_idx" ON "vaccination_cycle_vaccines"("cycle_id");
CREATE INDEX "vaccination_cycle_vaccines_vaccine_id_idx" ON "vaccination_cycle_vaccines"("vaccine_id");
CREATE INDEX "vaccination_cycle_vaccines_farm_id_updated_at_idx"
  ON "vaccination_cycle_vaccines"("farm_id", "updated_at");

CREATE TRIGGER "vaccination_cycle_vaccines_set_updated_at"
  BEFORE UPDATE ON "vaccination_cycle_vaccines"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
