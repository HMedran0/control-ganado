-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'OPERATOR', 'VET');

-- CreateEnum
CREATE TYPE "BreedGroup" AS ENUM ('INDICUS', 'TAURUS', 'CROSS');

-- CreateEnum
CREATE TYPE "VaccineScheduleType" AS ENUM ('OFFICIAL_CYCLE', 'AGE_WINDOW', 'INTERVAL', 'NONE');

-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('FEMALE', 'MALE');

-- CreateEnum
CREATE TYPE "Origin" AS ENUM ('BORN_ON_FARM', 'PURCHASED');

-- CreateEnum
CREATE TYPE "ExitType" AS ENUM ('SALE', 'DEATH', 'SLAUGHTER', 'THEFT', 'TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "IdentifierType" AS ENUM ('VISUAL_TAG', 'DIN', 'RFID', 'QR', 'BRAND', 'OTHER');

-- CreateEnum
CREATE TYPE "IdentifierRetireReason" AS ENUM ('LOST', 'DAMAGED', 'REASSIGNED', 'OTHER');

-- CreateEnum
CREATE TYPE "ServiceMethod" AS ENUM ('NATURAL', 'AI', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PregnancyOutcome" AS ENUM ('PENDING', 'CALVED', 'ABORTED', 'FAILED');

-- CreateEnum
CREATE TYPE "CalvingType" AS ENUM ('NORMAL', 'ASSISTED', 'CESAREAN');

-- CreateEnum
CREATE TYPE "WeightMethod" AS ENUM ('SCALE', 'TAPE', 'ESTIMATE');

-- CreateEnum
CREATE TYPE "ExpenseType" AS ENUM ('PURCHASE', 'FEED', 'MEDICATION', 'VACCINE', 'VETERINARY', 'TRANSPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "AllocationMethod" AS ENUM ('DIRECT', 'EQUAL', 'BY_WEIGHT');

-- CreateEnum
CREATE TYPE "ValuationMethod" AS ENUM ('MANUAL', 'PRICE_PER_KG');

-- CreateEnum
CREATE TYPE "WorkSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'ARCHIVE', 'RESTORE', 'VOID', 'EXIT', 'REVERT_EXIT', 'LOGIN');

-- CreateTable
CREATE TABLE "farms" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "municipality" TEXT,
    "department" TEXT,
    "ica_premise_code" TEXT,
    "settings" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "farms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "password_hash" TEXT NOT NULL,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "breeds" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "group" "BreedGroup" NOT NULL DEFAULT 'CROSS',
    "gestation_days" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "breeds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaccines" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "disease" TEXT NOT NULL,
    "default_dose" TEXT,
    "route" TEXT,
    "schedule_type" "VaccineScheduleType" NOT NULL DEFAULT 'INTERVAL',
    "booster_interval_days" INTEGER,
    "eligible_sex" "Sex",
    "min_age_days" INTEGER,
    "max_age_days" INTEGER,
    "block_ineligible_sex" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "vaccines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lots" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "animals" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "sex" "Sex" NOT NULL,
    "breed_id" UUID NOT NULL,
    "birth_date" DATE NOT NULL,
    "birth_date_estimated" BOOLEAN NOT NULL DEFAULT false,
    "origin" "Origin" NOT NULL,
    "origin_detail" TEXT,
    "entry_date" DATE NOT NULL,
    "dam_id" UUID,
    "sire_id" UUID,
    "sire_external_ref" TEXT,
    "birth_pregnancy_id" UUID,
    "lot_id" UUID,
    "for_sale" BOOLEAN NOT NULL DEFAULT false,
    "exit_type" "ExitType",
    "exit_date" DATE,
    "exit_reason" TEXT,
    "photo_url" TEXT,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "deleted_reason" TEXT,

    CONSTRAINT "animals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "animal_tags" (
    "animal_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "animal_tags_pkey" PRIMARY KEY ("animal_id","tag_id")
);

-- CreateTable
CREATE TABLE "identifiers" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "animal_id" UUID NOT NULL,
    "type" "IdentifierType" NOT NULL,
    "value" TEXT NOT NULL,
    "assigned_at" DATE NOT NULL,
    "retired_at" DATE,
    "retire_reason" "IdentifierRetireReason",
    "replaced_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pregnancies" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "dam_id" UUID NOT NULL,
    "service_date" DATE NOT NULL,
    "service_date_estimated" BOOLEAN NOT NULL DEFAULT false,
    "method" "ServiceMethod" NOT NULL,
    "sire_id" UUID,
    "sire_external_ref" TEXT,
    "confirmed_at" DATE,
    "expected_calving_date" DATE NOT NULL,
    "outcome" "PregnancyOutcome" NOT NULL DEFAULT 'PENDING',
    "outcome_date" DATE,
    "calving_type" "CalvingType",
    "stillborn_count" INTEGER NOT NULL DEFAULT 0,
    "is_imported" BOOLEAN NOT NULL DEFAULT false,
    "responsible" TEXT,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "voided_at" TIMESTAMPTZ,
    "void_reason" TEXT,

    CONSTRAINT "pregnancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaccination_records" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "animal_id" UUID NOT NULL,
    "vaccine_id" UUID NOT NULL,
    "applied_on" DATE NOT NULL,
    "dose" TEXT,
    "batch_number" TEXT,
    "ruv_number" TEXT,
    "cycle_id" UUID,
    "responsible" TEXT,
    "next_due_on" DATE,
    "work_session_id" UUID,
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ,
    "void_reason" TEXT,

    CONSTRAINT "vaccination_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treatment_records" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "animal_id" UUID NOT NULL,
    "started_on" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "medication" TEXT NOT NULL,
    "dose" TEXT,
    "duration_days" INTEGER NOT NULL DEFAULT 1,
    "withdrawal_meat_days" INTEGER NOT NULL DEFAULT 0,
    "withdrawal_milk_days" INTEGER NOT NULL DEFAULT 0,
    "withdrawal_until" DATE,
    "responsible" TEXT,
    "work_session_id" UUID,
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ,
    "void_reason" TEXT,

    CONSTRAINT "treatment_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weight_records" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "animal_id" UUID NOT NULL,
    "weighed_on" DATE NOT NULL,
    "weight_kg" DECIMAL(7,2) NOT NULL,
    "method" "WeightMethod" NOT NULL DEFAULT 'SCALE',
    "is_birth_weight" BOOLEAN NOT NULL DEFAULT false,
    "work_session_id" UUID,
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ,
    "void_reason" TEXT,

    CONSTRAINT "weight_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot_movements" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "animal_id" UUID NOT NULL,
    "from_lot_id" UUID,
    "to_lot_id" UUID,
    "moved_on" DATE NOT NULL,
    "work_session_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lot_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "type" "ExpenseType" NOT NULL,
    "occurred_on" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT NOT NULL,
    "allocation_method" "AllocationMethod" NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ,
    "void_reason" TEXT,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_allocations" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "expense_id" UUID NOT NULL,
    "animal_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "expense_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "animal_id" UUID NOT NULL,
    "sold_on" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "buyer" TEXT,
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ,
    "void_reason" TEXT,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valuations" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "animal_id" UUID NOT NULL,
    "valued_on" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "ValuationMethod" NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "valuations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_sessions" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "session_date" DATE NOT NULL,
    "activities" JSONB NOT NULL,
    "expected_lot_id" UUID,
    "status" "WorkSessionStatus" NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMPTZ,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_session_entries" (
    "id" UUID NOT NULL,
    "work_session_id" UUID NOT NULL,
    "animal_id" UUID NOT NULL,
    "processed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,

    CONSTRAINT "work_session_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "farm_id" UUID NOT NULL,
    "user_id" UUID,
    "entity" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" "AuditAction" NOT NULL,
    "diff" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaccination_cycles" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "is_official" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vaccination_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaccination_cycle_vaccines" (
    "cycle_id" UUID NOT NULL,
    "vaccine_id" UUID NOT NULL,

    CONSTRAINT "vaccination_cycle_vaccines_pkey" PRIMARY KEY ("cycle_id","vaccine_id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "total_rows" INTEGER NOT NULL,
    "created_rows" INTEGER NOT NULL,
    "error_rows" INTEGER NOT NULL,
    "summary" JSONB NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_farm_id_key" ON "memberships"("user_id", "farm_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "breeds_farm_id_name_key" ON "breeds"("farm_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "vaccines_farm_id_name_key" ON "vaccines"("farm_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "lots_farm_id_name_key" ON "lots"("farm_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "tags_farm_id_key_key" ON "tags"("farm_id", "key");

-- CreateIndex
CREATE INDEX "animals_farm_id_idx" ON "animals"("farm_id");

-- CreateIndex
CREATE INDEX "animals_farm_id_lot_id_idx" ON "animals"("farm_id", "lot_id");

-- CreateIndex
CREATE INDEX "animals_dam_id_idx" ON "animals"("dam_id");

-- CreateIndex
CREATE INDEX "animals_farm_id_birth_date_idx" ON "animals"("farm_id", "birth_date");

-- CreateIndex
CREATE INDEX "identifiers_farm_id_value_idx" ON "identifiers"("farm_id", "value");

-- CreateIndex
CREATE INDEX "identifiers_animal_id_idx" ON "identifiers"("animal_id");

-- CreateIndex
CREATE INDEX "pregnancies_farm_id_outcome_expected_calving_date_idx" ON "pregnancies"("farm_id", "outcome", "expected_calving_date");

-- CreateIndex
CREATE INDEX "pregnancies_dam_id_idx" ON "pregnancies"("dam_id");

-- CreateIndex
CREATE INDEX "vaccination_records_farm_id_animal_id_vaccine_id_applied_on_idx" ON "vaccination_records"("farm_id", "animal_id", "vaccine_id", "applied_on" DESC);

-- CreateIndex
CREATE INDEX "vaccination_records_farm_id_next_due_on_idx" ON "vaccination_records"("farm_id", "next_due_on");

-- CreateIndex
CREATE INDEX "treatment_records_farm_id_animal_id_idx" ON "treatment_records"("farm_id", "animal_id");

-- CreateIndex
CREATE INDEX "treatment_records_farm_id_withdrawal_until_idx" ON "treatment_records"("farm_id", "withdrawal_until");

-- CreateIndex
CREATE INDEX "weight_records_animal_id_weighed_on_idx" ON "weight_records"("animal_id", "weighed_on" DESC);

-- CreateIndex
CREATE INDEX "lot_movements_animal_id_idx" ON "lot_movements"("animal_id");

-- CreateIndex
CREATE INDEX "expenses_farm_id_occurred_on_idx" ON "expenses"("farm_id", "occurred_on");

-- CreateIndex
CREATE INDEX "expense_allocations_animal_id_idx" ON "expense_allocations"("animal_id");

-- CreateIndex
CREATE INDEX "expense_allocations_expense_id_idx" ON "expense_allocations"("expense_id");

-- CreateIndex
CREATE INDEX "sales_farm_id_sold_on_idx" ON "sales"("farm_id", "sold_on");

-- CreateIndex
CREATE INDEX "valuations_animal_id_valued_on_idx" ON "valuations"("animal_id", "valued_on" DESC);

-- CreateIndex
CREATE INDEX "work_sessions_farm_id_session_date_idx" ON "work_sessions"("farm_id", "session_date");

-- CreateIndex
CREATE UNIQUE INDEX "work_session_entries_work_session_id_animal_id_key" ON "work_session_entries"("work_session_id", "animal_id");

-- CreateIndex
CREATE INDEX "audit_logs_farm_id_entity_entity_id_idx" ON "audit_logs"("farm_id", "entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_farm_id_created_at_idx" ON "audit_logs"("farm_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "vaccination_cycles_farm_id_starts_on_idx" ON "vaccination_cycles"("farm_id", "starts_on");

-- CreateIndex
CREATE UNIQUE INDEX "vaccination_cycles_farm_id_name_key" ON "vaccination_cycles"("farm_id", "name");

-- CreateIndex
CREATE INDEX "import_batches_farm_id_created_at_idx" ON "import_batches"("farm_id", "created_at");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "breeds" ADD CONSTRAINT "breeds_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccines" ADD CONSTRAINT "vaccines_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animals" ADD CONSTRAINT "animals_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animals" ADD CONSTRAINT "animals_breed_id_fkey" FOREIGN KEY ("breed_id") REFERENCES "breeds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animals" ADD CONSTRAINT "animals_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animals" ADD CONSTRAINT "animals_dam_id_fkey" FOREIGN KEY ("dam_id") REFERENCES "animals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animals" ADD CONSTRAINT "animals_sire_id_fkey" FOREIGN KEY ("sire_id") REFERENCES "animals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animals" ADD CONSTRAINT "animals_birth_pregnancy_id_fkey" FOREIGN KEY ("birth_pregnancy_id") REFERENCES "pregnancies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animal_tags" ADD CONSTRAINT "animal_tags_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animal_tags" ADD CONSTRAINT "animal_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identifiers" ADD CONSTRAINT "identifiers_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identifiers" ADD CONSTRAINT "identifiers_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "identifiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pregnancies" ADD CONSTRAINT "pregnancies_dam_id_fkey" FOREIGN KEY ("dam_id") REFERENCES "animals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pregnancies" ADD CONSTRAINT "pregnancies_sire_id_fkey" FOREIGN KEY ("sire_id") REFERENCES "animals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccination_records" ADD CONSTRAINT "vaccination_records_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccination_records" ADD CONSTRAINT "vaccination_records_vaccine_id_fkey" FOREIGN KEY ("vaccine_id") REFERENCES "vaccines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccination_records" ADD CONSTRAINT "vaccination_records_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "vaccination_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccination_records" ADD CONSTRAINT "vaccination_records_work_session_id_fkey" FOREIGN KEY ("work_session_id") REFERENCES "work_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatment_records" ADD CONSTRAINT "treatment_records_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatment_records" ADD CONSTRAINT "treatment_records_work_session_id_fkey" FOREIGN KEY ("work_session_id") REFERENCES "work_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weight_records" ADD CONSTRAINT "weight_records_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weight_records" ADD CONSTRAINT "weight_records_work_session_id_fkey" FOREIGN KEY ("work_session_id") REFERENCES "work_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_movements" ADD CONSTRAINT "lot_movements_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuations" ADD CONSTRAINT "valuations_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_session_entries" ADD CONSTRAINT "work_session_entries_work_session_id_fkey" FOREIGN KEY ("work_session_id") REFERENCES "work_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_session_entries" ADD CONSTRAINT "work_session_entries_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccination_cycles" ADD CONSTRAINT "vaccination_cycles_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccination_cycle_vaccines" ADD CONSTRAINT "vaccination_cycle_vaccines_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "vaccination_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccination_cycle_vaccines" ADD CONSTRAINT "vaccination_cycle_vaccines_vaccine_id_fkey" FOREIGN KEY ("vaccine_id") REFERENCES "vaccines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
