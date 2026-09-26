-- Ejecutar como migración SQL posterior a la migración inicial de Prisma
-- (prisma migrate dev --create-only, pegar este contenido, luego aplicar).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Unicidad parcial
CREATE UNIQUE INDEX animals_farm_code_active_uq
  ON animals (farm_id, code) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX identifiers_farm_type_value_active_uq
  ON identifiers (farm_id, type, value) WHERE retired_at IS NULL;

CREATE UNIQUE INDEX pregnancies_dam_pending_uq
  ON pregnancies (dam_id) WHERE outcome = 'PENDING' AND voided_at IS NULL;

CREATE UNIQUE INDEX sales_animal_active_uq
  ON sales (animal_id) WHERE voided_at IS NULL;

-- Activos
CREATE INDEX animals_farm_active_idx
  ON animals (farm_id) WHERE deleted_at IS NULL AND exit_type IS NULL;

-- Búsqueda difusa
CREATE INDEX animals_code_trgm_idx ON animals USING gin (code gin_trgm_ops);
CREATE INDEX animals_name_trgm_idx ON animals USING gin (name gin_trgm_ops);
CREATE INDEX identifiers_value_trgm_idx ON identifiers USING gin (value gin_trgm_ops);

-- Integridad
ALTER TABLE animals ADD CONSTRAINT animals_exit_consistency_ck
  CHECK ((exit_type IS NULL) = (exit_date IS NULL));
ALTER TABLE animals ADD CONSTRAINT animals_not_own_dam_ck CHECK (dam_id IS NULL OR dam_id <> id);
ALTER TABLE animals ADD CONSTRAINT animals_not_own_sire_ck CHECK (sire_id IS NULL OR sire_id <> id);
ALTER TABLE weight_records ADD CONSTRAINT weight_positive_ck CHECK (weight_kg > 0 AND weight_kg < 2000);
ALTER TABLE expenses ADD CONSTRAINT expense_amount_positive_ck CHECK (amount > 0);
ALTER TABLE expense_allocations ADD CONSTRAINT allocation_amount_nonneg_ck CHECK (amount >= 0);
ALTER TABLE sales ADD CONSTRAINT sale_amount_positive_ck CHECK (amount > 0);
ALTER TABLE pregnancies ADD CONSTRAINT pregnancy_stillborn_ck CHECK (stillborn_count BETWEEN 0 AND 3);
ALTER TABLE identifiers ADD CONSTRAINT identifier_rfid_format_ck
  CHECK (type <> 'RFID' OR value ~ '^[0-9]{15}$');

ALTER TABLE vaccination_cycles ADD CONSTRAINT cycle_dates_ck CHECK (ends_on >= starts_on);
ALTER TABLE vaccines ADD CONSTRAINT vaccine_age_window_ck
  CHECK (min_age_days IS NULL OR max_age_days IS NULL OR max_age_days >= min_age_days);
ALTER TABLE vaccines ADD CONSTRAINT vaccine_interval_ck
  CHECK (schedule_type <> 'INTERVAL' OR booster_interval_days IS NOT NULL);
ALTER TABLE breeds ADD CONSTRAINT breed_gestation_ck
  CHECK (gestation_days IS NULL OR gestation_days BETWEEN 260 AND 310);
ALTER TABLE users ADD CONSTRAINT username_format_ck CHECK (username ~ '^[a-z0-9._-]{3,30}$');
