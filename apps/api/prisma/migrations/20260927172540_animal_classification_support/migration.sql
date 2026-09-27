-- Apoyo para clasificar animales en SQL (M4a, docs/adr/009-clasificacion-en-sql.md).

-- CreateIndex
CREATE INDEX "animal_tags_tag_id_idx" ON "animal_tags"("tag_id");

-- CreateIndex
CREATE INDEX "animals_sire_id_idx" ON "animals"("sire_id");

-- Meses cumplidos entre dos fechas con la convención de ADR-002 (recorte a fin de mes): del
-- 31/01 al 28/02 hay 1 mes. Es la traducción literal de `monthsBetween` de
-- packages/shared/src/domain/age.ts, incluido el signo negativo cuando `to_date` es anterior.
-- La prueba test/classification-equivalence.e2e-spec.ts las compara en cientos de miles de
-- pares de fechas. No usa `age()` de PostgreSQL, que trata distinto el paso de un 31 a un mes
-- de 30 días.
CREATE FUNCTION hato_months_elapsed(from_date date, to_date date) RETURNS integer
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN (EXTRACT(YEAR FROM to_date)::int * 12 + EXTRACT(MONTH FROM to_date)::int)
    - (EXTRACT(YEAR FROM from_date)::int * 12 + EXTRACT(MONTH FROM from_date)::int)
    - CASE
        WHEN EXTRACT(DAY FROM to_date)::int >= LEAST(
          EXTRACT(DAY FROM from_date)::int,
          EXTRACT(DAY FROM (date_trunc('month', to_date) + interval '1 month - 1 day'))::int)
        THEN 0
        ELSE 1
      END;

CREATE FUNCTION hato_months_between(from_date date, to_date date) RETURNS integer
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN CASE
    WHEN to_date < from_date THEN -hato_months_elapsed(to_date, from_date)
    ELSE hato_months_elapsed(from_date, to_date)
  END;
