-- M7: finanzas.
--
-- 1. `AllocationMethod.GENERAL`: gasto general de la finca, sin asignaciones a animales; no entra
--    en la inversión de ningún animal (RN-18) y sí en los gastos del período (ECO-06).
-- 2. `expenses`: `lot_id` (el lote elegido al repartir), `version` y `updated_by_id` para
--    corregirlo con control de versión (ADR-012). Las filas existentes toman como autor del último
--    cambio a quien las creó.
-- 3. `expense_allocations`: `voided_at` y `created_at`. Corregir un gasto anula las asignaciones
--    vigentes y crea las nuevas; anularlo anula las suyas (RN-11, ADR-016). A lo sumo una
--    asignación vigente por gasto y animal. Las existentes de un gasto anulado quedan anuladas
--    con él.
-- 4. `sales`: `version` y `updated_by_id`, para corregir precio, comprador y observaciones.
-- 5. `valuations`: `voided_at` y `void_reason`; un avalúo no se edita, se anula y se registra
--    otro. Monto positivo, como el de gastos y ventas.

-- AlterEnum
ALTER TYPE "AllocationMethod" ADD VALUE 'GENERAL';

-- AlterTable
ALTER TABLE "expense_allocations" ADD COLUMN     "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "voided_at" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "lot_id" UUID,
ADD COLUMN     "updated_by_id" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "updated_by_id" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "valuations" ADD COLUMN     "void_reason" TEXT,
ADD COLUMN     "voided_at" TIMESTAMPTZ;

-- Relleno de las filas existentes, sin el trigger `set_updated_at()`: no cambió nada que se
-- sincronice, así que `updated_at` no se mueve.
ALTER TABLE "expenses" DISABLE TRIGGER USER;
ALTER TABLE "sales" DISABLE TRIGGER USER;
ALTER TABLE "expense_allocations" DISABLE TRIGGER USER;
UPDATE "expenses" SET "updated_by_id" = "created_by_id";
UPDATE "sales" SET "updated_by_id" = "created_by_id";
UPDATE "expense_allocations" a
   SET "created_at" = e."created_at",
       "voided_at" = e."voided_at"
  FROM "expenses" e
 WHERE e."id" = a."expense_id";
ALTER TABLE "expenses" ENABLE TRIGGER USER;
ALTER TABLE "sales" ENABLE TRIGGER USER;
ALTER TABLE "expense_allocations" ENABLE TRIGGER USER;

ALTER TABLE "expenses" ALTER COLUMN "updated_by_id" SET NOT NULL;
ALTER TABLE "sales" ALTER COLUMN "updated_by_id" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Un gasto general no tiene lote. Se compara como texto: el valor nuevo del enum no se puede usar
-- en la misma transacción que lo agrega.
ALTER TABLE "expenses" ADD CONSTRAINT expense_general_without_lot_ck
  CHECK ("allocation_method"::text <> 'GENERAL' OR "lot_id" IS NULL);

-- A lo sumo una asignación vigente por gasto y animal.
CREATE UNIQUE INDEX expense_allocations_active_uq
  ON "expense_allocations" ("expense_id", "animal_id") WHERE "voided_at" IS NULL;

ALTER TABLE "valuations" ADD CONSTRAINT valuation_amount_positive_ck CHECK ("amount" > 0);
