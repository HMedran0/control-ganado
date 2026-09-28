-- Importación del inventario (ANI-09 CA6, RN-29; M4d).
--
-- `imported_prior_calvings`: partos anteriores al sistema que llegaron sin fecha. Número de
-- partos = este valor + preñeces CALVED registradas; no se inventan fechas de servicio, que
-- entrarían al intervalo entre partos (RN-38).
-- `entry_date_estimated`: la fecha de ingreso de un comprado no venía en el archivo y se tomó la
-- de nacimiento, para no dejarlo fuera de los ciclos oficiales pasados (ADR-004).

ALTER TABLE "animals"
  ADD COLUMN "entry_date_estimated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "imported_prior_calvings" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "animals"
  ADD CONSTRAINT "animals_imported_prior_calvings_check" CHECK ("imported_prior_calvings" >= 0);
