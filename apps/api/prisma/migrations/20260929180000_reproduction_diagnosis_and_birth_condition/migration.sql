-- Reproducción y nacimientos (M5: REP-02, REP-04, NAC-01).
--
-- pregnancies.diagnosis_responsible: quién palpó (REP-02 CA1). Texto, porque suele ser un
--   veterinario externo que no es usuario; diagnosis_responsible_user_id si lo es.
-- pregnancies.expected_calving_manual: el parto estimado se corrigió a mano; el recálculo por un
--   cambio de gestación (raza, finca o raza de la madre) no lo toca.
-- animals.birth_condition: estado al nacer (sana o débil) de una cría registrada con su parto
--   (NAC-01 CA2). Las muertas al nacer no son animales: siguen en pregnancies.stillborn_count.

CREATE TYPE "BirthCondition" AS ENUM ('HEALTHY', 'WEAK');

ALTER TABLE "animals" ADD COLUMN "birth_condition" "BirthCondition";
ALTER TABLE "animals" ADD CONSTRAINT "animals_birth_condition_ck"
  CHECK ("birth_condition" IS NULL OR "birth_pregnancy_id" IS NOT NULL);

ALTER TABLE "pregnancies"
  ADD COLUMN "diagnosis_responsible" TEXT,
  ADD COLUMN "diagnosis_responsible_user_id" UUID,
  ADD COLUMN "expected_calving_manual" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "pregnancies" ADD CONSTRAINT "pregnancies_diagnosis_responsible_user_id_fkey"
  FOREIGN KEY ("diagnosis_responsible_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
