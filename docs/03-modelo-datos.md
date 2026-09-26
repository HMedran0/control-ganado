# Modelo de datos

Motor: PostgreSQL 16+. ORM: Prisma. El esquema de referencia completo está en `docs/referencia/schema.prisma`; este documento explica las decisiones y las reglas que el esquema no puede expresar por sí solo.

> Nota de diseño: este modelo reemplaza el diagrama preliminar de la fase de análisis. Cambios principales: la madre se referencia directamente desde el animal (`damId`), los identificadores pasan a una tabla propia, los gastos se reparten mediante asignaciones y se añaden lotes, pesajes, tratamientos, jornadas y auditoría.

## 1. Convenciones globales

| Aspecto | Convención |
|---|---|
| Nombres | Modelos en PascalCase inglés; tablas y columnas en snake_case (`@@map` / `@map`). |
| Claves primarias | `id UUID` generado como UUIDv7 (ordenable por tiempo). Puede generarlo el cliente (necesario para la sincronización sin conexión de la fase 2). |
| Multi-finca | Toda tabla de negocio tiene `farm_id` NOT NULL con índice. Todas las consultas filtran por finca (ver arquitectura: `FarmScope`). |
| Fechas de negocio | Tipo `date` (sin hora ni zona): nacimiento, servicio, parto, vacunación, pesaje, gasto. Evita errores de zona horaria. |
| Marcas de tiempo | `timestamptz`: `created_at`, `updated_at`, `deleted_at`, `voided_at`. |
| Dinero | `numeric(14,2)` en COP. En JSON se serializa como string (`"1250000.00"`). Nunca `float`. |
| Peso | `numeric(7,2)` en kg. |
| Borrado | Nunca físico. Entidades maestras: `deleted_at` + `deleted_reason` (archivar). Eventos: `voided_at` + `void_reason` (anular). |
| Autoría | `created_by_id` y `updated_by_id` (FK a `users`) en tablas de negocio. |
| Versión | `version int` en entidades editables (control de concurrencia optimista y sincronización). |
| Derivados | Edad, categorías, número de partos, inversión: se calculan en consultas o vistas, no se almacenan (RN-16). |

## 2. Entidades

### 2.1 Organización y acceso

**Farm** — finca.
`id, name, municipality, department, ica_premise_code?, settings jsonb, created_at, updated_at`
`settings` (validado con zod en la API):
```json
{
  "gestationDays": 285,
  "weaningAgeMonths": 7,
  "minBreedingAgeMonths": 15,
  "calvingAlertDays": 30,
  "vaccineAlertDays": 15,
  "unconfirmedServiceAlertDays": 90,
  "calfCodePattern": "{YY}-{NNN}",
  "rabiesRiskZone": true,
  "pricePerKgByCategory": {}
}
```

**User** — `id, name, username (único global, `[a-z0-9._-]{3,30}`), email? (único si existe), password_hash, must_change_password bool, is_active, created_at, updated_at, last_login_at`

**Membership** — relación usuario–finca con rol. `id, user_id, farm_id, role (ADMIN|OPERATOR|VET), is_active`. Único (`user_id`, `farm_id`).

**RefreshToken** — `id, user_id, token_hash, family_id, expires_at, revoked_at, created_at, user_agent`. La rotación usa `family_id` para detectar reutilización y revocar toda la familia.

### 2.2 Catálogos

**Breed** — `id, farm_id, name, group (INDICUS|TAURUS|CROSS), gestation_days?, is_active`. Único (`farm_id`, `name`).
Semilla (grupo · gestación): Brahman, Cebú comercial, Gyr, Guzerá, Nelore (INDICUS · 293); Holstein, Pardo suizo, Simmental, Angus, Romosinuano, Costeño con cuernos, Blanco orejinegro (TAURUS · 283); Cruce, Girolando, Brahman × Pardo (CROSS · 288). Fuente y justificación: `08-dominio-y-finca-referencia.md` §1.4.

**Vaccine** — `id, farm_id, name, disease, default_dose, route, schedule_type (OFFICIAL_CYCLE|AGE_WINDOW|INTERVAL|NONE), booster_interval_days?, eligible_sex?, min_age_days?, max_age_days?, block_ineligible_sex, is_active`.
Semilla (08 §3.3): Aftosa (`OFFICIAL_CYCLE`); Brucelosis RB51 (`AGE_WINDOW`, FEMALE, 90–270 días, bloquea machos); Rabia silvestre (`OFFICIAL_CYCLE`, solo si `rabiesRiskZone`); Clostridial polivalente (`INTERVAL` 365, desde 90 días; valor ficticio).

**VaccinationCycle** — ciclos oficiales. `id, farm_id, name ("2026-1"), starts_on, ends_on, is_official`. Único (`farm_id`, `name`). **VaccinationCycleVaccine** — vacunas del ciclo (N:M). Semilla: 2025-2 (27/10/2025–16/12/2025) y 2026-1 (04/05/2026–23/06/2026) reales; 2026-2 ficticio (01/11/2026–15/12/2026).

**Lot** — `id, farm_id, name, description?, is_active`. Único (`farm_id`, `name`).

**Tag** — etiquetas manuales. `id, farm_id, key, label, is_system`. Semilla de sistema: `COTERO`.

### 2.3 Animal e identificación

**Animal**
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | |
| farm_id | uuid FK | |
| code | text | Código interno. Único (`farm_id`, `code`) entre no archivados → índice único parcial `WHERE deleted_at IS NULL`. |
| name | text? | |
| sex | enum `FEMALE`/`MALE` | |
| breed_id | uuid FK | |
| birth_date | date | |
| birth_date_estimated | bool | |
| origin | enum `BORN_ON_FARM`/`PURCHASED` | |
| origin_detail | text? | Vendedor, finca de origen. |
| entry_date | date | = birth_date si nació en la finca. |
| dam_id | uuid? FK → animals | Madre. |
| sire_id | uuid? FK → animals | Padre si es toro de la finca. |
| sire_external_ref | text? | Pajilla, toro prestado. |
| birth_pregnancy_id | uuid? FK → pregnancies | Preñez de la que nació. |
| lot_id | uuid? FK | Lote actual. |
| for_sale | bool | Disponible para venta. |
| exit_type | enum? `SALE`/`DEATH`/`SLAUGHTER`/`THEFT`/`TRANSFER`/`OTHER` | Nulo = activo. |
| exit_date | date? | |
| exit_reason | text? | |
| photo_url | text? | |
| notes | text? | |
| version, created_*, updated_*, deleted_at, deleted_reason | | |

Restricciones:
- CHECK `exit_type IS NULL` ⇔ `exit_date IS NULL`.
- CHECK `dam_id <> id` y `sire_id <> id`.
- El sexo de la madre (FEMALE) y del padre (MALE) se valida en la capa de dominio (Postgres no valida columnas de otra fila con CHECK).

**AnimalTag** — N:M animal–etiqueta manual. `animal_id, tag_id, created_at, created_by_id`. PK compuesta.

**Identifier**
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | |
| farm_id | uuid | |
| animal_id | uuid FK | |
| type | enum `VISUAL_TAG`/`DIN`/`RFID`/`QR`/`BRAND`/`OTHER` | |
| value | text | Normalizado: sin espacios; RFID solo dígitos (15). |
| assigned_at | date | |
| retired_at | date? | Nulo = activo. |
| retire_reason | enum? `LOST`/`DAMAGED`/`REASSIGNED`/`OTHER` | |
| replaced_by_id | uuid? FK → identifiers | |

Índice único parcial: (`farm_id`, `type`, `value`) `WHERE retired_at IS NULL` (RN-19). Índice no único en (`farm_id`, `value`) para la búsqueda global por cualquier tipo.

### 2.4 Reproducción

**Pregnancy** — ciclo reproductivo de una hembra.
| Campo | Tipo | Notas |
|---|---|---|
| id, farm_id | | |
| dam_id | uuid FK | Hembra. |
| service_date | date | Real o estimada. |
| service_date_estimated | bool | true si se registró desde palpación sin servicio conocido. |
| method | enum `NATURAL`/`AI`/`UNKNOWN` | |
| sire_id | uuid? FK → animals | |
| sire_external_ref | text? | |
| confirmed_at | date? | Palpación positiva. |
| expected_calving_date | date | Almacenada (se congela con el parámetro vigente al registrar; se recalcula si cambia `service_date`). |
| outcome | enum `PENDING`/`CALVED`/`ABORTED`/`FAILED` | |
| outcome_date | date? | Fecha de parto, aborto o diagnóstico negativo. |
| calving_type | enum? `NORMAL`/`ASSISTED`/`CESAREAN` | |
| stillborn_count | int default 0 | Crías muertas al nacer. |
| is_imported | bool | Preñez histórica creada por la importación (sin crías enlazadas, RN-29). |
| notes | text? | |
| responsible | text? | Veterinario o persona. |
| voided_at, void_reason, created_*, updated_*, version | | |

Índice único parcial: (`dam_id`) `WHERE outcome = 'PENDING' AND voided_at IS NULL` (RN-03).

Decisión: `expected_calving_date` es la excepción a "no almacenar derivados" porque el parámetro de días de gestación puede cambiar y la fecha comunicada a la finca no debe moverse sola; además permite indexar la consulta de partos próximos.

Las crías vivas de un parto se enlazan con `Animal.birth_pregnancy_id`. El total de nacidos de un parto = crías con ese `birth_pregnancy_id` + `stillborn_count`.

### 2.5 Sanidad y pesos

**VaccinationRecord** — `id, farm_id, animal_id, vaccine_id, applied_on date, dose, batch_number?, ruv_number?, cycle_id?, responsible, next_due_on date?, work_session_id?, notes?, voided_at, void_reason, created_*`.
Índices: (`farm_id`, `animal_id`, `vaccine_id`, `applied_on` DESC), (`farm_id`, `next_due_on`).

**TreatmentRecord** — `id, farm_id, animal_id, started_on date, reason, medication, dose, duration_days, withdrawal_meat_days, withdrawal_milk_days, withdrawal_until date (calculada al guardar = started_on + duration_days + max(retiros)), responsible, work_session_id?, notes?, voided_*, created_*`.

**WeightRecord** — `id, farm_id, animal_id, weighed_on date, weight_kg numeric(7,2), method enum SCALE/TAPE/ESTIMATE, is_birth_weight bool, work_session_id?, notes?, voided_*, created_*`.
Índice: (`animal_id`, `weighed_on` DESC).

**LotMovement** — historial de cambios de lote. `id, farm_id, animal_id, from_lot_id?, to_lot_id?, moved_on date, work_session_id?, created_*`.

### 2.6 Economía (solo ADMIN)

**Expense**
`id, farm_id, type enum (PURCHASE, FEED, MEDICATION, VACCINE, VETERINARY, TRANSPORT, OTHER), occurred_on date, amount numeric(14,2), description, allocation_method enum (DIRECT, EQUAL, BY_WEIGHT), voided_*, created_*`

**ExpenseAllocation** — `id, farm_id, expense_id, animal_id, amount numeric(14,2)`.
Invariante (RN-17): suma de asignaciones = `expense.amount`. Se crean en la misma transacción que el gasto.

**Sale** — `id, farm_id, animal_id (único mientras no esté anulada), sold_on date, amount numeric(14,2), buyer?, notes?, voided_*, created_*`.

**Valuation** — `id, farm_id, animal_id, valued_on date, amount numeric(14,2), method enum MANUAL/PRICE_PER_KG, created_*`.

### 2.7 Jornadas y auditoría

**WorkSession** — `id, farm_id, name, session_date date, activities jsonb, expected_lot_id?, status enum OPEN/CLOSED, closed_at?, created_*`.
`activities` ejemplo: `[{"type":"VACCINATION","vaccineId":"…","dose":"2 ml"},{"type":"WEIGHT"}]`.

**WorkSessionEntry** — `id, work_session_id, animal_id, processed_at timestamptz, created_by_id`. Único (`work_session_id`, `animal_id`). Los eventos creados en la jornada referencian `work_session_id`.

**ImportBatch** — `id, farm_id, file_name, total_rows, created_rows, error_rows, summary jsonb, created_by_id, created_at`. Registro de cada importación confirmada (ANI-09).

**AuditLog** — `id bigserial, farm_id, user_id, entity text, entity_id uuid, action enum CREATE/UPDATE/ARCHIVE/RESTORE/VOID/EXIT/REVERT_EXIT/LOGIN, diff jsonb, created_at timestamptz`.
Índices: (`farm_id`, `entity`, `entity_id`), (`farm_id`, `created_at` DESC). Solo inserción.

## 3. Relaciones (resumen)

```
Farm 1─N Membership N─1 User
Farm 1─N Animal, Breed, Vaccine, Lot, Tag, Expense, WorkSession, AuditLog
Breed 1─N Animal
Lot 1─N Animal (lote actual)
Animal 1─N Animal (madre → crías, damId)
Animal 1─N Animal (padre → crías, sireId)
Animal 1─N Identifier, VaccinationRecord, TreatmentRecord, WeightRecord, LotMovement, Valuation
Animal 1─N Pregnancy (como madre)
Pregnancy 1─N Animal (crías nacidas, birthPregnancyId)
Animal 0..1─1 Sale (vigente)
Expense 1─N ExpenseAllocation N─1 Animal
Animal N─M Tag (AnimalTag)
WorkSession 1─N WorkSessionEntry; eventos → WorkSession (opcional)
```

## 4. Consultas derivadas clave

Implementar como vista SQL o consulta en el repositorio de dominio. Deben usarse las mismas funciones en tablero, listados y reportes para que los números coincidan.

**Animales activos**: `deleted_at IS NULL AND exit_type IS NULL`.

**Clasificación derivada** (por animal, con `today` en zona `America/Bogota` y parámetros de la finca):
```sql
-- esquema de la lógica (implementación final en src/domain/classification)
is_calf        = age_months(birth_date, today) < weaning_age_months
calf_male      = is_calf AND sex = 'MALE'
calf_female    = is_calf AND sex = 'FEMALE'
-- categoría de manejo (exclusiva): CALF_* | HEIFER (hembra, no calf, calving_count = 0) | COW (hembra, calving_count >= 1)
--                                 | YOUNG_MALE (macho, no calf, edad < 24 m) | ADULT_MALE (macho, edad >= 24 m)
dry (Horra)    = COW AND NOT pregnant AND NOT served AND age_months(last_calving_date, today) >= weaning_age_months
calved         = EXISTS (pregnancy p WHERE p.dam_id = a.id AND p.outcome = 'CALVED' AND p.voided_at IS NULL)
pregnant       = EXISTS (pregnancy p WHERE p.dam_id = a.id AND p.outcome = 'PENDING' AND p.confirmed_at IS NOT NULL AND p.voided_at IS NULL)
served         = EXISTS (pregnancy p WHERE p.dam_id = a.id AND p.outcome = 'PENDING' AND p.confirmed_at IS NULL AND p.voided_at IS NULL)
calving_count  = COUNT(pregnancy WHERE outcome = 'CALVED' AND voided_at IS NULL)
```

**Estado de vacunas por animal** — depende de `schedule_type` (RN-13). Para `OFFICIAL_CYCLE`: elegibles activos sin registro con `applied_on` dentro del ciclo. Para `AGE_WINDOW`: elegibles por sexo y edad sin ningún registro de esa vacuna. Para `INTERVAL`, última aplicación vigente por vacuna:
```sql
SELECT DISTINCT ON (animal_id, vaccine_id) animal_id, vaccine_id, applied_on, next_due_on
FROM vaccination_records
WHERE farm_id = $1 AND voided_at IS NULL
ORDER BY animal_id, vaccine_id, applied_on DESC;
-- vencida: next_due_on < today ; próxima: next_due_on BETWEEN today AND today + alert_days
```

**Partos próximos**: preñeces `PENDING`, confirmadas, no anuladas, con `expected_calving_date <= today + calving_alert_days`, ordenadas por fecha.

**Inversión por animal**: `SUM(expense_allocations.amount)` uniendo con gastos no anulados.

**Edad legible**: función compartida en `packages/shared` (`formatAge`), usada por web, móvil y reportes.

## 5. Índices recomendados (además de PK/FK)

- `animals (farm_id, code)` único parcial `WHERE deleted_at IS NULL`.
- `animals (farm_id) WHERE deleted_at IS NULL AND exit_type IS NULL` (activos).
- `animals (farm_id, lot_id)`, `animals (dam_id)`, `animals (farm_id, birth_date)`.
- Búsqueda por texto: `pg_trgm` GIN en `animals.code`, `animals.name`, `identifiers.value`.
- `identifiers (farm_id, type, value)` único parcial activos; `identifiers (farm_id, value)`.
- `pregnancies (farm_id, outcome, expected_calving_date)`; único parcial por `dam_id` pendiente.
- `vaccination_records (farm_id, animal_id, vaccine_id, applied_on DESC)`, `(farm_id, next_due_on)`.
- `weight_records (animal_id, weighed_on DESC)`.
- `expense_allocations (animal_id)`, `(expense_id)`.
- Índices parciales y `pg_trgm` se crean con migraciones SQL manuales, porque Prisma no los expresa todos.

## 6. Datos semilla

`pnpm db:seed` reproduce **exactamente** la finca de referencia ficticia de `08-dominio-y-finca-referencia.md` §3:
- Finca La Esperanza (vereda Loma Grande, San Juan Nepomuceno), parámetros y ciclos de vacunación.
- Usuarios `alvaro` (ADMIN), `wilmer` y `yeison` (OPERATOR), `paola.vet` (VET). Contraseña de desarrollo en `.env.example`, nunca en producción.
- Catálogos semilla (razas con grupo y gestación, vacunas con programación, etiqueta COTERO, lotes Paridas, Horras y novillas, Levante, Toros).
- 284 animales activos con la distribución de 08 §3.2, historial 2024–2026, 10 vendidos y 3 muertos.
- El seed es **determinista** (generador con semilla fija y "hoy" fijado en `SEED_TODAY=2026-09-25`) para que las pruebas E2E puedan afirmar cifras exactas del tablero (por ejemplo, 284 activos, 64 + 7 preñadas, 14 terneras pendientes de brucelosis).
- `pnpm db:seed:load` genera 5.000 animales y 50.000 eventos para pruebas de rendimiento (RNF-01).
- La plantilla `docs/referencia/plantilla-importacion.xlsx` contiene 12 filas de ejemplo de esta misma finca para probar ANI-09.
