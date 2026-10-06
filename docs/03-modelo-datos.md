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
  "overdueCalvingAlertDays": 15,
  "calfCodePattern": "{YY}-{NNN}",
  "rabiesRiskZone": true,
  "pricePerKgByCategory": {},
  "codeReuse": false,
  "codeSuggestion": "PATTERN",
  "productionSystem": "DOBLE_PROPOSITO",
  "salesFocus": null,
  "dryOffBeforeCalvingDays": 60,
  "weightGainAlertKgPerDay": { "YOUNG_MALE": 0.3 },
  "weightLossAlertPercent": 5,
  "weightGainAnchorMaxDays": 180,
  "targetSaleWeightKg": { "YOUNG_MALE": 450, "ADULT_MALE": 450 },
  "scaleStableToleranceKg": 1,
  "scaleStableSeconds": 2,
  "scaleMinWeightKg": 20,
  "scaleZeroThresholdKg": 10
}
```
`overdueCalvingAlertDays` (M5, RN-39): días después del parto estimado de una preñez abierta para la alerta «Parto vencido sin registrar»; 15 por defecto [Validar]. Campos de la validación con ganaderos (09): `codeReuse` y `codeSuggestion` (`PATTERN` | `LOWEST_FREE`) de ANI-10 (M4c); `productionSystem` (`CRIA` | `LEVANTE_CEBA` | `LECHERIA` | `DOBLE_PROPOSITO` | `CICLO_COMPLETO`) y `salesFocus` (`MALES` | `FEMALES` | `BOTH` | `null`) de CFG-03 (M8); `dryOffBeforeCalvingDays` de LEC-03 (M9b); `weightGainAlertKgPerDay` (por categoría de manejo, hasta tres decimales), `weightLossAlertPercent` (entero) y `weightGainAnchorMaxDays` (antigüedad máxima del ancla de la ganancia de 90 días, 180 [Validar], ADR-015) de PES-05 (M6); `targetSaleWeightKg` (por categoría de manejo, kilos enteros; 450 en Levante y Toro [Validar]) de PES-06 (M8a; los machos con la etiqueta del sistema `REPRODUCTOR` no tienen peso de venta); `scaleStableToleranceKg`, `scaleStableSeconds`, `scaleMinWeightKg` y `scaleZeroThresholdKg`, las condiciones de guardado del pesaje en vivo (PES-03 CA2 y CA3, F2, M15; 09 v1.4). Los valores por defecto marcados [Validar] en 08 §3.7 se confirman con la finca.

**User** — `id, name, username (único global, `[a-z0-9._-]{3,30}`), email? (único si existe), email_verified_at timestamptz?, password_hash?, must_change_password bool, is_active, created_at, updated_at, last_login_at`
- `password_hash` pasa a opcional en M10a: quien acepta una invitación con Google (AUT-13 CA2) puede no tener contraseña. Nunca queda un usuario sin ningún método de acceso: sin contraseña, no se puede desvincular Google (`LAST_LOGIN_METHOD`).
- Si `password_hash` es nulo, el inicio de sesión con contraseña ejecuta igual una verificación Argon2 contra un hash simulado y responde el mismo error genérico (`AUTH_INVALID_CREDENTIALS`): el tiempo de respuesta no debe revelar qué cuentas entran solo con Google (M10a, ADR-007 decisión 8). Una prueba de M10a compara los tiempos de respuesta de los dos casos.
- `email` se guarda **normalizado** (sin espacios, en minúsculas) y se compara así en invitaciones, verificación, recuperación y Google (AUT-12 a AUT-15). Es obligatorio para quien tenga una membresía ADMIN: la regla se verifica en la aplicación (`EMAIL_REQUIRED_FOR_ADMIN`), porque un CHECK no puede mirar las membresías.
- `email_verified_at` (M10a, AUT-14): se llena al abrir el enlace de verificación o al aceptar una invitación (el enlace llegó a ese buzón). Cambiar el correo lo vuelve a `null`. Solo un correo verificado sirve para recuperar la contraseña o entrar con Google.

**Membership** — relación usuario–finca con rol. `id, user_id, farm_id, role (ADMIN|OPERATOR|VET), is_active`. Único (`user_id`, `farm_id`).

**RefreshToken** — `id, user_id, farm_id, token_hash, family_id, family_started_at timestamptz, last_used_at timestamptz, expires_at, revoked_at, created_at, user_agent`. La rotación usa `family_id` para detectar reutilización y revocar toda la familia. `farm_id` es la finca activa de la sesión: la rotación la conserva, de modo que renovar el token no devuelve al usuario a su finca por defecto (M1, ADR-007).
- Sesión deslizante (M4d, AUT-10): cada rotación recalcula `expires_at = min(ahora + REFRESH_TTL_DAYS, family_started_at + REFRESH_MAX_AGE_DAYS)`. `family_started_at` se copia de token en token y no cambia dentro de la familia: es el inicio de sesión con contraseña (o Google) que la originó.
- `last_used_at` alimenta la lista de sesiones (AUT-11) y se actualiza como máximo una vez por hora por familia: al rotar, el token nuevo copia el valor anterior si tiene menos de una hora (implementado en M4d).
- La rotación revoca el token anterior y crea el nuevo en la misma transacción: una familia abierta siempre tiene exactamente un token sin revocar y sin vencer. Una **sesión** abierta es eso, y `AccessGuard` lo comprueba en cada petición con el `sid` del token de acceso.
- La migración de M4d rellenó `family_started_at` de los tokens existentes con la creación del primer token de su familia, y `last_used_at` con la de cada token.
- Una **sesión** de la interfaz es una familia: se lista por `family_id` con el token vigente de cada una.

**EmailToken** (M10a, AUT-14) — enlaces de un solo uso enviados por correo. `id, user_id, purpose enum (VERIFY_EMAIL, RESET_PASSWORD), email, token_hash (único), expires_at, used_at?, created_at`. Solo se guarda el hash (SHA-256 con el pepper, como el refresco). `email` es el correo normalizado al que se envió: si el usuario cambió de correo después, el enlace de verificación ya no sirve. Vencen a las 24 h (verificación) y a 1 h (recuperación). Índice: (`user_id`, `purpose`, `created_at`) para el límite de 3 envíos por hora.

**Invitation** (M10a, AUT-13) — `id, farm_id, email, role, token_hash (único), invited_by (user_id), expires_at, accepted_at?, accepted_by?, revoked_at?, created_at`. `email` normalizado. Vence a los 7 días; reenviar genera un token nuevo y reemplaza el hash (el enlace anterior deja de servir). Único parcial (`farm_id`, `email`) `WHERE accepted_at IS NULL AND revoked_at IS NULL`: una sola invitación pendiente por correo en cada finca. Invitar un correo que ya es de un usuario de **otra** finca es válido; al aceptarla se le agrega la membresía en esta.

**UserIdentity** (M10a, AUT-15) — cuentas vinculadas. `id, user_id, provider enum (GOOGLE), subject, email, linked_at`. Único (`provider`, `subject`). Después del primer ingreso el vínculo se busca por `subject`, no por correo. `email` es el que reportó el proveedor al vincular, normalizado, solo como referencia.

**OAuthIntent** (M10a, AUT-15) — intención de un solo uso para empezar el flujo de Google con un propósito. `id, purpose enum (LINK, ACCEPT_INVITATION), user_id?, invitation_id?, intent_hash (único), expires_at (5 min), used_at?`. Para vincular, `POST /me/identities/google/link` verifica la contraseña y crea una con `LINK`; para aceptar una invitación con Google, `POST /invitations/google` crea una con `ACCEPT_INVITATION`. Así el token de la invitación nunca viaja en la URL del flujo.

**OAuthState** (M10a, AUT-15) — estado del flujo de autorización, del lado del servidor. `id, state_hash (único), nonce, code_verifier, purpose enum (LOGIN, LINK, ACCEPT_INVITATION), user_id?, invitation_id?, expires_at (10 min), used_at?`. `state` viaja a Google y vuelve; `nonce` se compara con el del `id_token`; `code_verifier` completa PKCE. Las filas vencidas se borran al arrancar la API, como los intentos de inicio de sesión.

**LoginAttempt** — intentos de inicio de sesión, para el bloqueo de AUT-01 CA3. `id bigserial, login, ip, succeeded, created_at`. No tiene `farm_id`: el intento ocurre antes de saber quién escribe, e incluso antes de saber si el usuario existe. El bloqueo **no se almacena**, se deduce de estas filas: cinco fallos en los 15 minutos anteriores al último fallo bloquean hasta *último fallo + 15 min*; un ingreso exitoso reinicia el conteo (ADR-007). El bloqueo es solo por `login`; la `ip` queda para trazabilidad, no bloquea (en la finca todos comparten la IP). Guarda direcciones IP, que son dato personal: las filas de más de 30 días se borran al arrancar la API. Índices: (`login`, `created_at`), (`ip`, `created_at`), (`created_at`).

### 2.2 Catálogos

**Breed** — `id, farm_id, name, group (INDICUS|TAURUS|CROSS), gestation_days?, is_active, version`. Único (`farm_id`, `lower(name)`).
Semilla (grupo · gestación): Brahman, Cebú comercial, Gyr, Guzerá, Nelore (INDICUS · 293); Holstein, Pardo suizo, Simmental, Angus, Romosinuano, Costeño con cuernos, Blanco orejinegro (TAURUS · 283); Cruce, Girolando, Brahman × Pardo (CROSS · 288). Fuente y justificación: `08-dominio-y-finca-referencia.md` §1.4.

**Vaccine** — `id, farm_id, name, disease, default_dose, route, schedule_type (OFFICIAL_CYCLE|AGE_WINDOW|INTERVAL|NONE), booster_interval_days?, eligible_sex?, min_age_days?, max_age_days?, block_ineligible_sex, is_active, version`. Único (`farm_id`, `lower(name)`).
Semilla (08 §3.3): Aftosa (`OFFICIAL_CYCLE`); Brucelosis RB51 (`AGE_WINDOW`, FEMALE, 90–270 días, bloquea machos); Rabia silvestre (`OFFICIAL_CYCLE`, solo si `rabiesRiskZone`); Clostridial polivalente (`INTERVAL` 365, desde 90 días; valor ficticio).

**VaccinationCycle** — ciclos oficiales. `id, farm_id, name ("2026-1"), starts_on, ends_on, is_official, is_active, version`. Único (`farm_id`, `lower(name)`). **VaccinationCycleVaccine** — vacunas del ciclo (N:M). Desde M6 (ADR-012) `id, farm_id, cycle_id, vaccine_id, created_at, removed_at?, removed_by_id?, updated_at`: quitar una vacuna del ciclo marca `removed_at` (CHECK: los dos o ninguno), único parcial (`cycle_id`, `vaccine_id`) `WHERE removed_at IS NULL`, trigger `set_updated_at()` e índice (`farm_id`, `updated_at`). Semilla: 2025-2 (27/10/2025–16/12/2025) y 2026-1 (04/05/2026–23/06/2026) reales; 2026-2 ficticio (01/11/2026–15/12/2026).

**Lot** — `id, farm_id, name, description?, is_active, version`. Único (`farm_id`, `lower(name)`).

**Tag** — etiquetas manuales. `id, farm_id, key, label, description?, is_system, is_active, version`. Único (`farm_id`, `key`) y (`farm_id`, `lower(label)`). La `key` se genera del nombre al crear la etiqueta y no cambia al renombrarla. Semilla de sistema: `COTERO` y, desde M8a, `REPRODUCTOR` («Reproductor»: macho que la finca conserva para servir, sin peso objetivo de venta, PES-06), que no se pueden desactivar ni renombrar (solo se edita su descripción). En el seed, los cuatro toros de La Esperanza y el 48 de El Retiro la tienen. Ninguna regla usa una etiqueta que la finca no tenga: sin `REPRODUCTOR`, ningún animal es reproductor.

**Catálogos (M3).** Los nombres se guardan normalizados (sin espacios al inicio ni al final, sin espacios dobles) y son únicos por finca **sin distinguir mayúsculas**: «Brahman», «brahman » y «Brahman» son el mismo. Los catálogos no se borran: se desactivan (`is_active = false`), dejan de ofrecerse en los formularios y conservan su historial. `Farm` y los catálogos llevan `version` para el control de concurrencia de `PATCH` (05, «Convenciones»).

### 2.3 Animal e identificación

**Animal**
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | |
| farm_id | uuid FK | |
| code | text | Código interno. Único (`farm_id`, `code`) entre no archivados → índice único parcial `WHERE deleted_at IS NULL`. Desde M4c (RN-30, RN-31): el índice pasa al código **normalizado** (sin espacios, en mayúsculas y, si es numérico, sin ceros a la izquierda) y a los animales **activos** (`WHERE deleted_at IS NULL AND exit_type IS NULL`); con `codeReuse = false`, la unicidad entre todos los no archivados se verifica en la aplicación dentro de la transacción. |
| name | text? | |
| sex | enum `FEMALE`/`MALE` | |
| breed_id | uuid FK | |
| birth_date | date | |
| birth_date_estimated | bool | |
| origin | enum `BORN_ON_FARM`/`PURCHASED` | |
| origin_detail | text? | Vendedor, finca de origen. |
| entry_date | date | = birth_date si nació en la finca. |
| entry_date_estimated | bool | La importación no traía la fecha de ingreso de un comprado y tomó la de nacimiento (ANI-09 CA2, M4d). Vuelve a `false` cuando alguien corrige la fecha. |
| imported_prior_calvings | int, ≥ 0 | Partos anteriores al sistema que llegaron por importación sin fecha (RN-29, M4d). Número de partos = este valor + preñeces `CALVED` no anuladas; no aporta fecha de último parto. CHECK `imported_prior_calvings >= 0`. |
| dam_id | uuid? FK → animals | Madre. |
| sire_id | uuid? FK → animals | Padre si es toro de la finca. |
| sire_external_ref | text? | Pajilla, toro prestado. |
| birth_pregnancy_id | uuid? FK → pregnancies | Preñez de la que nació. |
| birth_condition | enum? `HEALTHY`/`WEAK` | Estado al nacer de una cría registrada con su parto (REP-04, NAC-01 CA2; M5). CHECK: solo con `birth_pregnancy_id`. Las muertas al nacer no son animales. |
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

**AnimalTag** — N:M animal–etiqueta manual. `id, farm_id, animal_id, tag_id, created_at, created_by_id, removed_at?, removed_by_id?, updated_at`. Desde M5 (ADR-012) quitar una etiqueta no borra la fila: marca `removed_at` y `removed_by_id` (CHECK: los dos o ninguno), para que la sincronización lleve el cambio y la pestaña Cambios diga «Quitó la etiqueta X». Único parcial (`animal_id`, `tag_id`) `WHERE removed_at IS NULL`: volver a poner una etiqueta quitada crea otra fila. Las consultas de etiquetas filtran las quitadas.

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
| retire_reason | enum? `LOST`/`DAMAGED`/`REASSIGNED`/`EXITED`/`ARCHIVED`/`OTHER` | Los pone el sistema, nunca una persona: `EXITED` (M4c, IDN-06), chapeta liberada al registrar la salida en una finca con numeración reutilizable, nunca con DIN ni RFID (RN-32); `ARCHIVED` (M4c, ANI-03 CA4), cualquier identificador retirado al archivar el animal, DIN y RFID incluidos (única excepción de RN-32). Revertir la salida o restaurar el animal los reactiva si siguen libres. Un valor `EXITED` se reasigna sin confirmación; uno `ARCHIVED`, con la del ADMIN (RN-19). |
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
| confirmed_at | date? | Palpación positiva. Una segunda palpación positiva conserva la primera fecha. |
| diagnosis_responsible | text? | Quién palpó (REP-02 CA1, M5): texto, porque suele ser un veterinario externo que no es usuario. |
| diagnosis_responsible_user_id | uuid? FK → users | Si quien palpó es usuario de la finca (M5). |
| diagnosis_notes | text? | Observaciones de la palpación (M6), aparte de `notes` para no pisarlas. Una palpación posterior sin observaciones las conserva; con observaciones, las reemplaza. |
| expected_calving_date | date | Almacenada. Se recalcula si cambia `service_date` y, desde M5, si cambia la gestación que le aplica (ver la decisión de abajo). |
| expected_calving_manual | bool default false | Alguien corrigió a mano el parto estimado (`PATCH` con `expectedCalvingDate`, M5): el recálculo por gestación no lo toca. Cambiar después el servicio vuelve a calcularlo y quita la marca. |
| outcome | enum `PENDING`/`CALVED`/`ABORTED`/`FAILED` | |
| outcome_date | date? | Fecha de parto, aborto o diagnóstico negativo. |
| calving_type | enum? `NORMAL`/`ASSISTED`/`CESAREAN` | |
| stillborn_count | int default 0 | Crías muertas al nacer. |
| is_imported | bool | Preñez histórica creada por la importación (sin crías enlazadas, RN-29). |
| notes | text? | |
| responsible | text? | Veterinario o persona. |
| voided_at, void_reason, created_*, updated_*, version | | |

Índice único parcial: (`dam_id`) `WHERE outcome = 'PENDING' AND voided_at IS NULL` (RN-03).

Decisión: `expected_calving_date` es la excepción a "no almacenar derivados": permite indexar la consulta de partos próximos y conservar una corrección hecha a mano.

Decisión de M5 (reemplaza la de «se congela con el parámetro vigente al registrar»): cuando cambia la gestación que aplica a una preñez **abierta y no anulada**, su parto estimado se recalcula en la misma transacción del cambio, en tres casos: la gestación de la raza (`PATCH /breeds/:id`), la gestación de la finca para las razas sin gestación propia (`PATCH /farm`) y la raza de la madre (`PATCH /animals/:id`). Las preñeces con `expected_calving_manual` no se tocan. Cada recálculo queda en la auditoría de la preñez (`UPDATE`, con el motivo) y la respuesta trae la advertencia `EXPECTED_CALVING_RECALCULATED` («Se recalculó el parto estimado de N preñeces abiertas», con cuántas se omitieron por estar corregidas a mano). Las cerradas nunca cambian.

Reglas de M5 en la API: una sola preñez abierta por hembra (candado de la fila de la hembra + el índice único parcial); el servicio es posterior al último parto o aborto; ninguna palpación, aborto ni parto es anterior al servicio. El parto sin preñez abierta crea una preñez ya cerrada con `service_date` = parto − gestación, `service_date_estimated = true` y `method = UNKNOWN` (no entra en los indicadores, RN-38).

Las crías vivas de un parto se enlazan con `Animal.birth_pregnancy_id`. El total de nacidos de un parto = crías con ese `birth_pregnancy_id` + `stillborn_count`.

### 2.5 Sanidad y pesos

**VaccinationRecord** — `id, farm_id, animal_id, vaccine_id, applied_on date, dose, batch_number?, ruv_number?, cycle_id?, responsible, next_due_on date?, work_session_id?, notes?, voided_at, void_reason, created_*`.
Índices: (`farm_id`, `animal_id`, `vaccine_id`, `applied_on` DESC), (`farm_id`, `next_due_on`).

**TreatmentRecord** — `id, farm_id, animal_id, started_on date, reason, medication, dose, duration_days, withdrawal_meat_days, withdrawal_milk_days, withdrawal_until date (calculada al guardar = started_on + duration_days + max(retiros); nula si los dos retiros son 0), responsible, work_session_id?, expense_id? (M6: gasto del costo, solo ADMIN), notes?, voided_*, created_*`.
Desde M6 los fines de retiro de carne y de leche se derivan de las columnas (`treatmentWithdrawal` de shared): «En retiro» usa `withdrawal_until` (el más lejano) y RN-22 el de carne. Anular el tratamiento anula su gasto.

**WeightRecord** — `id, farm_id, animal_id, weighed_on date, weight_kg numeric(7,2), method enum SCALE/TAPE/ESTIMATE, is_birth_weight bool, scale_serial text?, work_session_id?, notes?, voided_*, created_*`. `scale_serial` es el número de serie del indicador que envió el peso en el pesaje en vivo (PES-03 CA6, M15), para trazabilidad; nulo en los pesajes digitados o importados.
Desde M6, dos campos más, porque son dos cosas distintas (PIL-05): `identified_by enum RFID_READER | QR | SEARCH | IMPORT` (cómo se identificó el animal; **nulo** cuando nadie lo identificó: peso al nacer del parto, peso inicial del alta, pesajes del seed) y `weight_source enum MANUAL | SCALE_FILE | SCALE_LIVE` (de dónde salió el peso, `MANUAL` por defecto). CHECK `weight_source = 'MANUAL' OR identified_by IS NOT NULL`. La importación de la báscula (PES-04) usa `IMPORT` y `SCALE_FILE`; el pesaje en vivo (PES-03), `RFID_READER` y `SCALE_LIVE`.
Índice: (`animal_id`, `weighed_on` DESC).
La importación de la báscula (PES-04, M6) crea una `WorkSession` con actividad `WEIGHT` y un `WeightRecord` por animal, método `SCALE`, en una transacción.

**ScaleProfile** (M6, PES-04) — perfil de báscula de la finca: cómo leer el archivo que exporta su indicador. `id, farm_id, name, file_format enum (CSV, XLSX), column_mapping jsonb, created_*, updated_*, version`. `column_mapping` dice qué columna trae el RFID o EID, el número visual, el peso y la fecha y hora (y el separador y el formato de fecha del CSV). Único (`farm_id`, `lower(name)`), como los catálogos. Agrega `source_template_key text?` y `source_template_version int?` cuando el perfil nació de duplicar una plantilla del sistema. Implementado en M6 con `created_by_id`, `updated_by_id`, `updated_at` con el trigger e índice (`farm_id`, `updated_at`). `column_mapping` (`ScaleColumnMapping` de shared): listas de encabezados aceptados para `eid`, `visualId`, `weight`, `date` y `time`, `dateFormat` (`DMY`, `MDY`, `YMD`) y `unit` (`KG` o `LB`; las libras se convierten a kilos con redondeo a 0,1 kg).

**Plantillas de báscula del sistema** (PES-04, 09 v1.4) — no son filas: se definen en código en `packages/shared` (`key`, `name`, `version`, `fileFormat`, `columnMapping`, `provisional`), iguales para todas las fincas. La primera es **Tru-Test** (XR5000, ID5000 y S3, archivo por USB o por la app del fabricante), **provisional** hasta definir sus columnas con un archivo real de la finca piloto. Una corrección del mapeo sube su `version` y llega de inmediato a todas las fincas que usan la plantilla; una finca que la **duplicó** tiene su propio `ScaleProfile`, editable, que no cambia solo.

**MilkRecord** (M9b, LEC-01) — control lechero. `id, farm_id, animal_id, recorded_on date, milking enum (AM, PM, TOTAL), liters numeric(6,2), method enum (METER, ESTIMATE), unfit_for_sale bool, work_session_id?, notes?, voided_at, void_reason, created_*`.
Índices: (`farm_id`, `recorded_on`), (`animal_id`, `recorded_on` DESC); único parcial (`animal_id`, `recorded_on`, `milking`) `WHERE voided_at IS NULL` (RN-36: un segundo registro del mismo ordeño anula el anterior).
`unfit_for_sale` se fija al guardar si la vaca tenía retiro de leche vigente (LEC-01 CA4).

**DryOffRecord** (M9b, LEC-03) — secado. `id, farm_id, animal_id, dried_on date, reason enum (END_OF_LACTATION, LOW_PRODUCTION, PRE_CALVING, ILLNESS, OTHER), notes?, voided_at, void_reason, created_*`. Índice: (`animal_id`, `dried_on` DESC).

**LotMovement** — historial de cambios de lote. `id, farm_id, animal_id, from_lot_id?, to_lot_id?, moved_on date, work_session_id?, created_*`.

### 2.6 Economía (solo ADMIN)

**Expense**
`id, farm_id, type enum (PURCHASE, FEED, MEDICATION, VACCINE, VETERINARY, TRANSPORT, OTHER), occurred_on date, amount numeric(14,2), description, allocation_method enum (DIRECT, EQUAL, BY_WEIGHT, GENERAL), lot_id?, version, updated_by_id, voided_*, created_*`

`GENERAL` (M7): gasto de la finca sin asignaciones; `CHECK` sin lote. `lot_id` (M7): el lote elegido al repartir; el reparto se fija al guardar.

**ExpenseAllocation** — `id, farm_id, expense_id, animal_id, amount numeric(14,2), created_at, voided_at?`.
Invariante (RN-17): suma de las asignaciones **vigentes** = `expense.amount`. Se crean en la misma transacción que el gasto. Desde M7 (ADR-016) no se editan: corregir el gasto anula las vigentes y crea las nuevas; anularlo las anula. A lo sumo una vigente por gasto y animal (índice único parcial `expense_allocations_active_uq`).

**Sale** — `id, farm_id, animal_id (único mientras no esté anulada), sold_on date, amount numeric(14,2), buyer?, notes?, version, updated_by_id, voided_*, created_*`. Desde M7 se corrigen `amount`, `buyer` y `notes` con `version`.

**Valuation** — `id, farm_id, animal_id, valued_on date, amount numeric(14,2) > 0, method enum MANUAL/PRICE_PER_KG, voided_at?, void_reason?, created_*`. Desde M7 se anula (no se edita).

### 2.7 Jornadas y auditoría

**WorkSession** — `id, farm_id, name, session_date date, activities jsonb, expected_lot_id?, status enum OPEN/CLOSED, closed_at?, created_*`. Actividades: las de JOR-01 (vacunación, pesaje, palpación, tratamiento, cambio de lote, etiqueta). La actividad de pesaje `WEIGHT` también la crea la importación de la báscula (PES-04), y desde M9b se agrega `MILKING` (jornada de ordeño, LEC-01 CA2).
`activities` ejemplo: `[{"type":"VACCINATION","vaccineId":"…","dose":"2 ml"},{"type":"WEIGHT"}]`.

**WorkSessionEntry** — `id, work_session_id, animal_id, processed_at timestamptz, created_by_id`. Único (`work_session_id`, `animal_id`). Los eventos creados en la jornada referencian `work_session_id`. Desde M9, los eventos registrados en una jornada (vacunación, tratamiento, palpación, pesaje) guardan también `identified_by` (`RFID_READER | QR | SEARCH | IMPORT`), como `WeightRecord`.

**ImportBatch** — `id, farm_id, idempotency_key uuid, file_sha256 text, kind (ANIMALS | WEIGHTS, M6), work_session_id? (M6, la jornada de pesaje de la báscula), file_name, total_rows, created_rows, error_rows, summary jsonb, created_by_id, created_at`. Registro de cada importación confirmada (ANI-09). Único (`farm_id`, `idempotency_key`): la clave la genera la web al elegir el archivo y repetirla devuelve el mismo lote (ADR-011). `file_sha256` permite avisar en la simulación que el archivo ya se importó. `summary` guarda filas con advertencias, filas desmarcadas y razas creadas.

**IdempotencyKey** (M5, ADR-012) — `id, farm_id, key uuid, method text, path text, request_hash text, response_status int, response_body jsonb, created_at timestamptz`. Único (`farm_id`, `key`). Guarda la respuesta de una acción (salida, reversión, archivo, anulación, operación en lote…) para devolverla igual si se repite con el mismo encabezado `Idempotency-Key`; otra petición con la misma clave responde `IDEMPOTENCY_KEY_REUSED`. Se purga a los 7 días. Nunca guarda respuestas de `/auth`. La importación no la usa: su clave vive en `import_batches.idempotency_key` (ADR-011).

**Escrituras sin conexión (ADR-012, desde M5).** Toda tabla editable tiene `version`. Toda tabla que se sincronizará (animales, identificadores, catálogos, configuración, eventos, jornadas) tiene `updated_at timestamptz` con índice (`farm_id`, `updated_at`), mantenido por un **trigger** de la base (función `set_updated_at()`, `BEFORE UPDATE`) y no por `@updatedAt` de Prisma, porque hay escrituras con SQL directo. Hecho en M5 (migración `offline_ready_writes`): `farms`, `animals`, `animal_tags`, `identifiers`, los catálogos (`breeds`, `vaccines`, `vaccination_cycles`, `lots`, `tags`), `pregnancies`, los eventos (`vaccination_records`, `treatment_records`, `weight_records`, `lot_movements`), `work_sessions` y los económicos (`expenses`, `expense_allocations`, `sales`, `valuations`). El trigger pone `now()` (inicio de la transacción) en **cada** `UPDATE`, también si la sentencia intentó fijar otro valor: la marca la decide la base. Los `INSERT` sí pueden traer su `updated_at` (el seed lo escribe explícito para ser determinista, y ya no hace `UPDATE` después de sembrar). Desde M6 también `vaccination_cycle_vaccines` y `scale_profiles`. Quedan sin `updated_at` `users` y `memberships` (no se sincronizan; `users` conserva `@updatedAt`) y `work_session_entries` (sin `farm_id`; se corrige en M9).

**Sesión en UTC.** El adaptador de Prisma (`@prisma/adapter-pg`) envía y lee `timestamptz` sin desfase; con la sesión de PostgreSQL en otra zona (`PGTZ=America/Bogota` en el contenedor) las marcas se guardaban cinco horas corridas y lo que genera la base (`now()`) se leía cinco horas antes. La API y el seed abren sus conexiones con `TimeZone=UTC` (`src/infra/db-session.ts`). Las fechas de negocio son `date` y no dependen de esto (ADR-002).

**AuditLog** — `id bigserial, farm_id, user_id, entity text, entity_id uuid, action enum CREATE/UPDATE/ARCHIVE/RESTORE/VOID/EXIT/REVERT_EXIT/LOGIN/IMPORT/ACCEPT_INVITATION/VERIFY_EMAIL/RESET_PASSWORD/LINK_IDENTITY/UNLINK_IDENTITY/REVOKE_SESSIONS/EXPORT, diff jsonb, created_at timestamptz`.
Exportación completa (BAK-02, M8b): `EXPORT` sobre la entidad `Farm` con el id de la finca, escrita antes de generar el ZIP. El límite de tres por hora por finca se deduce de estas filas (ADR-018), sin tabla propia.
Cuentas y correo (M4d, M10a): invitación creada, reenviada y anulada → entidad `Invitation` con `CREATE`, `UPDATE` y `VOID`; aceptada → `ACCEPT_INVITATION`; correo verificado → `VERIFY_EMAIL`; contraseña restablecida por correo → `RESET_PASSWORD`; Google vinculado y desvinculado → `LINK_IDENTITY` y `UNLINK_IDENTITY`; sesiones cerradas por el ADMIN o por el propio usuario → `REVOKE_SESSIONS`. El `diff` nunca guarda tokens, hashes, contraseñas ni el `code_verifier`.
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

Implementación (M4a, ADR-009): la CTE `classificationCtes` de `apps/api/src/animals/classification.sql.ts`, con todos los valores como parámetros (hoy, parámetros de la finca, códigos) y la edad con `hato_months_between(from, to)`, función SQL que traduce `monthsBetween` (ADR-002). Solo filtra y cuenta; lo que se muestra de cada animal se calcula con las funciones de shared. `test/classification-equivalence.e2e-spec.ts` comprueba que los dos caminos coinciden animal por animal.

**Estado de vacunas por animal** — depende de `schedule_type` (RN-13). Para `OFFICIAL_CYCLE`: elegibles activos sin registro con `applied_on` dentro del ciclo. Para `AGE_WINDOW`: elegibles por sexo y edad sin ningún registro de esa vacuna. Para `INTERVAL`, última aplicación vigente por vacuna:
```sql
SELECT DISTINCT ON (animal_id, vaccine_id) animal_id, vaccine_id, applied_on, next_due_on
FROM vaccination_records
WHERE farm_id = $1 AND voided_at IS NULL
ORDER BY animal_id, vaccine_id, applied_on DESC;
-- vencida: next_due_on < today ; próxima: next_due_on BETWEEN today AND today + alert_days
```

**Partos próximos**: preñeces `PENDING`, confirmadas, no anuladas, con `expected_calving_date <= today + calving_alert_days`, ordenadas por fecha.

**Parto vencido sin registrar** (M5, RN-39): preñez `PENDING` no anulada (confirmada o no) con `today - expected_calving_date > overdue_calving_alert_days`. Es la columna `calving_overdue` de `classificationCtes` y el filtro `alerts=calving_overdue`; shared la calcula con `isCalvingOverdue`, y la prueba de equivalencia de ADR-009 compara los dos caminos, también con casos creados por la API (mellizos, aborto, servicio estimado, anuladas, horra que vuelve a servicio).

**Intervalo entre partos** (REP-05, RN-38): `calvingIntervals` de shared sobre las preñeces `CALVED` no anuladas de la hembra, por pares consecutivos con servicio real.

**Estado de lactancia** (M9b, LEC-02, RN-34 y RN-37), por vaca, con la misma estrategia de ADR-009 (función en shared + equivalente SQL cubierto por la prueba de equivalencia):
```sql
last_calving   = MAX(outcome_date) de preñeces CALVED no anuladas
last_dry_off   = MAX(dried_on) de secados no anulados
lactating      = last_calving IS NOT NULL AND (last_dry_off IS NULL OR last_dry_off < last_calving)
dried_off      = last_dry_off IS NOT NULL AND last_dry_off >= last_calving
days_in_milk   = today - last_calving            -- solo si lactating
dry_off_soon   = lactating AND pregnant AND expected_calving_date - today < dry_off_before_calving_days
```
Un parto nuevo sin secado previo cierra la lactancia anterior y abre otra (RN-37): por eso basta comparar el último secado con el último parto. `DRIED_OFF` (Seca) no es `DRY` (Horra).

**Ganancia de peso** (M6, PES-05, ADR-015): con los pesajes no anulados de cada animal (orden: fecha e `id`), ganancia entre el último y el último de una fecha anterior, la de 90 días (regresión lineal de los pesajes de `[hoy − 90, hoy]` más el último anterior como ancla si está a lo sumo `weightGainAnchorMaxDays` antes; al menos uno en la ventana, dos puntos y 30 días entre el primero y el último) y desde el peso al nacer. Todo con enteros (centésimas de kilo, días) y redondeado a milésimas de kg/día mitad lejos de cero antes de comparar. Alertas: ganancia de 90 días menor que `weightGainAlertKgPerDay` de su categoría; último pesaje menor que el anterior en más de `weightLossAlertPercent`. Es `weight_facts` dentro de `classificationCtes` (`weight-gain.sql.ts`), con las columnas `low_gain` y `weight_loss`, comprobada contra shared por la prueba de equivalencia de ADR-009.

**Estado de vacunas en SQL** (M6, ADR-009 decisión 8): la CTE `vaccine_status` (`vaccine-status.sql.ts`) da estado, motivo y fecha límite por animal activo y vacuna con programación, y `classificationCtes` las resume en `vaccine_overdue` y `vaccine_due`. Reemplaza el cálculo en memoria del filtro de alertas de vacunas.

**Peso de venta** (M8a, PES-06, ADR-017): en `classificationCtes`, para los activos que no son reproductores, `sale_target_cents` (el objetivo de su categoría), `sale_weight_on` (último pesaje + ⌈10 · faltante en centésimas / ganancia de 90 días en milésimas⌉ días, si la ganancia es positiva) y `sale_weight_status` (`reached`, `this_month`, `likely_reached`, `later`). Además `is_breeder`, `milk_withdrawal` y `gain_threshold_milli`. Igual a `saleWeightProjection` de shared, animal por animal (prueba de equivalencia). La edad se calcula una vez por animal (`LATERAL` con `OFFSET 0`): `hato_months_between` no se expande en línea y cada uso de la categoría la volvía a llamar.

**Intervalo entre partos del hato** (M8a, RN-38): `herdCalvingIntervalsSql` (`apps/api/src/dashboard/calving-intervals.sql.ts`) une cada parto de una hembra activa con el anterior (`lag` por fecha e id) y descarta los pares con servicio estimado; promedio y distribución por rangos, iguales a `herdCalvingIntervals` de shared sobre el seed.

**Inversión por animal**: `SUM(expense_allocations.amount)` de las asignaciones vigentes de gastos no anulados (CTE `investment`, `apps/api/src/finance/investment.sql.ts`), igual a `animalInvestment` de shared animal por animal (prueba de equivalencia de M7, ADR-016).

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
- Desde M4c: único parcial `animals_farm_code_norm_active_uq` sobre `(farm_id, hato_normalize_code(code))` de los animales activos (RN-30, RN-31), en lugar del de `(farm_id, code)` entre no archivados, y un índice no único `animals_farm_code_norm_idx` sobre la misma expresión para la búsqueda exacta, el número anterior (ANI-11) y la verificación de las fincas sin reutilización. `hato_normalize_code` es la traducción literal de `normalizeAnimalCode` de shared (NFC; sin espacio, tabulador, salto de línea ni U+00A0 en los extremos; mayúsculas con una lista cerrada de letras; sin ceros a la izquierda si es numérico) y una prueba de integración las compara. La migración falla, nombrando los códigos, si encuentra duplicados normalizados.
- `milk_records (farm_id, recorded_on)`, `(animal_id, recorded_on DESC)` y único parcial `(animal_id, recorded_on, milking) WHERE voided_at IS NULL`; `dry_off_records (animal_id, dried_on DESC)` (M9b).
- `refresh_tokens (user_id, family_id)` para listar sesiones; `email_tokens (token_hash)` único y `(user_id, purpose, created_at)`; `invitations (token_hash)` único y único parcial `(farm_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL`; `user_identities (provider, subject)` único; `oauth_intents (intent_hash)` y `oauth_states (state_hash)` únicos (M4d, M10a).
- Desde M5: `animal_tags (animal_id, tag_id)` único parcial `WHERE removed_at IS NULL`; `(farm_id, updated_at)` en todas las tablas que se sincronizarán; `idempotency_keys (farm_id, key)` único y `(created_at)` para la purga.
- Índices parciales y `pg_trgm` se crean con migraciones SQL manuales, porque Prisma no los expresa todos.

## 6. Datos semilla

`pnpm db:seed` reproduce **exactamente** la finca de referencia ficticia de `08-dominio-y-finca-referencia.md` §3:
- Finca La Esperanza (vereda Loma Grande, San Juan Nepomuceno), parámetros y ciclos de vacunación.
- Usuarios `alvaro` (ADMIN), `wilmer` y `yeison` (OPERATOR), `paola.vet` (VET). Contraseña de desarrollo en `.env.example`, nunca en producción.
- Catálogos semilla (razas con grupo y gestación, vacunas con programación, etiquetas COTERO y REPRODUCTOR (M8a), lotes Paridas, Horras y novillas, Levante, Toros).
- 284 animales activos con la distribución de 08 §3.2, historial 2024–2026, 10 vendidos y 3 muertos.
- El seed es **determinista** (generador con semilla fija y "hoy" fijado en `SEED_TODAY=2026-09-25`) para que las pruebas E2E puedan afirmar cifras exactas del tablero (por ejemplo, 284 activos, 64 + 7 preñadas, 14 terneras pendientes de brucelosis).
- M6 cambia el último pesaje (15/09/2026) de cinco levantes: tres ganaron solo 15 kg desde el 15/06 y dos perdieron el 8 %. Se aplica después de la economía y sin consumir el generador, así que ninguna otra cifra cambia; `expected.ts` suma `EXPECTED_WEIGHT_ALERTS = { lowGain: 5, weightLoss: 2 }` (los que perdieron peso también tienen ganancia baja).
- M5 agrega a la finca de referencia 2 partos vencidos sin registrar (RN-39): dos de los 9 partos próximos con el servicio más atrás, de modo que su parto estimado pasó hace 16 a 41 días. Siguen siendo preñadas y partos próximos, así que ninguna otra cifra cambia; `expected.ts` suma solo `calvingsOverdue: 2`.
- `pnpm db:seed:load` genera 5.000 animales y 50.000 eventos para pruebas de rendimiento (RNF-01).
- M4c agrega una segunda finca de pruebas, **Finca El Retiro** [Ficticio], con `codeReuse = true`, `LOWEST_FREE` y numeración 1–40, con al menos dos números reutilizados (08 §3.5). La finca de referencia sigue con `codeReuse = false`.
- M9b agrega a la finca de referencia 90 días de control lechero y algunos secados (08 §3.6), con sus cifras nuevas en `expected.ts`.
- La plantilla `docs/referencia/plantilla-importacion.xlsx` contiene 12 filas de ejemplo de esta misma finca para probar ANI-09 (11 entran; la 13 tiene un error a propósito).
- M4d agrega una tercera finca de pruebas, **Finca La Nueva** [Ficticio] (08 §3.8): sin animales, con las razas y los lotes de La Esperanza y el ADMIN `nueva.admin`, para importar la plantilla (sus códigos chocarían con los de La Esperanza). Las cifras de las otras dos fincas no cambian.
