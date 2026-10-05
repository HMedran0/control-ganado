/**
 * Enums del dominio. Los nombres y valores son exactamente los de
 * `docs/referencia/schema.prisma`, para que un valor de Prisma sea asignable sin conversión.
 *
 * Se usan objetos `as const` en lugar de `enum` de TypeScript: `erasableSyntaxOnly` está
 * activo en este paquete (los `enum` generan código en tiempo de ejecución) y así los valores
 * son cadenas comparables con lo que llega de la base de datos y del JSON.
 */

/** Rol del usuario en una finca. */
export const ROLE = {
  ADMIN: 'ADMIN',
  OPERATOR: 'OPERATOR',
  VET: 'VET',
} as const;
export type Role = (typeof ROLE)[keyof typeof ROLE];

/** Grupo racial; determina la gestación por defecto (08 §1.4). */
export const BREED_GROUP = {
  INDICUS: 'INDICUS',
  TAURUS: 'TAURUS',
  CROSS: 'CROSS',
} as const;
export type BreedGroup = (typeof BREED_GROUP)[keyof typeof BREED_GROUP];

/** Tipo de programación de una vacuna (08 §1.5). */
export const VACCINE_SCHEDULE_TYPE = {
  OFFICIAL_CYCLE: 'OFFICIAL_CYCLE',
  AGE_WINDOW: 'AGE_WINDOW',
  INTERVAL: 'INTERVAL',
  NONE: 'NONE',
} as const;
export type VaccineScheduleType =
  (typeof VACCINE_SCHEDULE_TYPE)[keyof typeof VACCINE_SCHEDULE_TYPE];

/** Sexo del animal. */
export const SEX = {
  FEMALE: 'FEMALE',
  MALE: 'MALE',
} as const;
export type Sex = (typeof SEX)[keyof typeof SEX];

/** Procedencia del animal. */
export const ORIGIN = {
  BORN_ON_FARM: 'BORN_ON_FARM',
  PURCHASED: 'PURCHASED',
} as const;
export type Origin = (typeof ORIGIN)[keyof typeof ORIGIN];

/** Motivo de salida del inventario. */
export const EXIT_TYPE = {
  SALE: 'SALE',
  DEATH: 'DEATH',
  SLAUGHTER: 'SLAUGHTER',
  THEFT: 'THEFT',
  TRANSFER: 'TRANSFER',
  OTHER: 'OTHER',
} as const;
export type ExitType = (typeof EXIT_TYPE)[keyof typeof EXIT_TYPE];

/** Medio de identificación. */
export const IDENTIFIER_TYPE = {
  VISUAL_TAG: 'VISUAL_TAG',
  DIN: 'DIN',
  RFID: 'RFID',
  QR: 'QR',
  BRAND: 'BRAND',
  OTHER: 'OTHER',
} as const;
export type IdentifierType = (typeof IDENTIFIER_TYPE)[keyof typeof IDENTIFIER_TYPE];

/**
 * Motivo de retiro de un identificador. `EXITED` y `ARCHIVED` (M4c) los pone el sistema al
 * registrar una salida (IDN-06) o al archivar el animal (ANI-03, excepción de RN-32); una persona
 * solo elige entre `MANUAL_RETIRE_REASONS`.
 */
export const IDENTIFIER_RETIRE_REASON = {
  LOST: 'LOST',
  DAMAGED: 'DAMAGED',
  REASSIGNED: 'REASSIGNED',
  EXITED: 'EXITED',
  ARCHIVED: 'ARCHIVED',
  OTHER: 'OTHER',
} as const;
export type IdentifierRetireReason =
  (typeof IDENTIFIER_RETIRE_REASON)[keyof typeof IDENTIFIER_RETIRE_REASON];

/** Motivos que una persona puede elegir al retirar o reemplazar un identificador. */
export const MANUAL_RETIRE_REASONS = [
  IDENTIFIER_RETIRE_REASON.LOST,
  IDENTIFIER_RETIRE_REASON.DAMAGED,
  IDENTIFIER_RETIRE_REASON.REASSIGNED,
  IDENTIFIER_RETIRE_REASON.OTHER,
] as const;
export type ManualRetireReason = (typeof MANUAL_RETIRE_REASONS)[number];

/** Método del servicio reproductivo. */
export const SERVICE_METHOD = {
  NATURAL: 'NATURAL',
  AI: 'AI',
  UNKNOWN: 'UNKNOWN',
} as const;
export type ServiceMethod = (typeof SERVICE_METHOD)[keyof typeof SERVICE_METHOD];

/** Desenlace de una preñez. */
export const PREGNANCY_OUTCOME = {
  PENDING: 'PENDING',
  CALVED: 'CALVED',
  ABORTED: 'ABORTED',
  FAILED: 'FAILED',
} as const;
export type PregnancyOutcome = (typeof PREGNANCY_OUTCOME)[keyof typeof PREGNANCY_OUTCOME];

/** Tipo de parto. */
export const CALVING_TYPE = {
  NORMAL: 'NORMAL',
  ASSISTED: 'ASSISTED',
  CESAREAN: 'CESAREAN',
} as const;
export type CalvingType = (typeof CALVING_TYPE)[keyof typeof CALVING_TYPE];

/**
 * Estado de cada cría al registrar el parto (REP-04). `STILLBORN` (muerta al nacer) no crea animal:
 * suma a `Pregnancy.stillbornCount` (REP-04 CA4).
 */
export const CALF_HEALTH = {
  ALIVE: 'ALIVE',
  WEAK: 'WEAK',
  STILLBORN: 'STILLBORN',
} as const;
export type CalfHealth = (typeof CALF_HEALTH)[keyof typeof CALF_HEALTH];

/** Estado al nacer que se guarda en la cría viva (`Animal.birthCondition`, NAC-01 CA2). */
export const BIRTH_CONDITION = {
  HEALTHY: 'HEALTHY',
  WEAK: 'WEAK',
} as const;
export type BirthCondition = (typeof BIRTH_CONDITION)[keyof typeof BIRTH_CONDITION];

/** Resultado de la palpación o ecografía (REP-02). */
export const DIAGNOSIS_RESULT = {
  POSITIVE: 'POSITIVE',
  NEGATIVE: 'NEGATIVE',
} as const;
export type DiagnosisResult = (typeof DIAGNOSIS_RESULT)[keyof typeof DIAGNOSIS_RESULT];

/** Método de pesaje. La finca de referencia usa cinta bovinométrica (08 §1.7). */
export const WEIGHT_METHOD = {
  SCALE: 'SCALE',
  TAPE: 'TAPE',
  ESTIMATE: 'ESTIMATE',
} as const;
export type WeightMethod = (typeof WEIGHT_METHOD)[keyof typeof WEIGHT_METHOD];

/**
 * Cómo se identificó al animal al registrar el evento (PES-01, PIL-05; M6). `null` en la base
 * cuando nadie lo identificó: pesajes del seed, peso al nacer del parto y peso inicial del alta.
 */
export const IDENTIFIED_BY = {
  /** Lector RFID (modo teclado en la web, Bluetooth en el móvil). */
  RFID_READER: 'RFID_READER',
  /** QR del sistema escaneado. */
  QR: 'QR',
  /** Búsqueda por código, nombre o chapeta. */
  SEARCH: 'SEARCH',
  /** Importación de un archivo (sesión de la báscula, PES-04). */
  IMPORT: 'IMPORT',
} as const;
export type IdentifiedBy = (typeof IDENTIFIED_BY)[keyof typeof IDENTIFIED_BY];

/** De dónde salió el peso (PES-01, PIL-05; M6). */
export const WEIGHT_SOURCE = {
  /** Digitado por una persona. */
  MANUAL: 'MANUAL',
  /** Archivo exportado por el indicador de la báscula (PES-04). */
  SCALE_FILE: 'SCALE_FILE',
  /** Indicador conectado en vivo (PES-03, fase 2). */
  SCALE_LIVE: 'SCALE_LIVE',
} as const;
export type WeightSource = (typeof WEIGHT_SOURCE)[keyof typeof WEIGHT_SOURCE];

/** Formato del archivo que exporta la báscula (PES-04). */
export const SCALE_FILE_FORMAT = {
  CSV: 'CSV',
  XLSX: 'XLSX',
} as const;
export type ScaleFileFormat = (typeof SCALE_FILE_FORMAT)[keyof typeof SCALE_FILE_FORMAT];

/** Unidad del peso en el archivo de la báscula (PES-04). Las libras se convierten a kilos. */
export const SCALE_UNIT = {
  KG: 'KG',
  LB: 'LB',
} as const;
export type ScaleUnit = (typeof SCALE_UNIT)[keyof typeof SCALE_UNIT];

/** Qué importó un lote de importación (ANI-09 o PES-04). */
export const IMPORT_KIND = {
  ANIMALS: 'ANIMALS',
  WEIGHTS: 'WEIGHTS',
} as const;
export type ImportKind = (typeof IMPORT_KIND)[keyof typeof IMPORT_KIND];

/** Actividad de una jornada de manejo (JOR-01). La importación de la báscula crea `WEIGHT`. */
export const WORK_SESSION_ACTIVITY = {
  VACCINATION: 'VACCINATION',
  WEIGHT: 'WEIGHT',
  DIAGNOSIS: 'DIAGNOSIS',
  TREATMENT: 'TREATMENT',
  LOT_CHANGE: 'LOT_CHANGE',
  TAG: 'TAG',
} as const;
export type WorkSessionActivity =
  (typeof WORK_SESSION_ACTIVITY)[keyof typeof WORK_SESSION_ACTIVITY];

/** Tipo de gasto. */
export const EXPENSE_TYPE = {
  PURCHASE: 'PURCHASE',
  FEED: 'FEED',
  MEDICATION: 'MEDICATION',
  VACCINE: 'VACCINE',
  VETERINARY: 'VETERINARY',
  TRANSPORT: 'TRANSPORT',
  OTHER: 'OTHER',
} as const;
export type ExpenseType = (typeof EXPENSE_TYPE)[keyof typeof EXPENSE_TYPE];

/** Forma de repartir un gasto entre animales. */
export const ALLOCATION_METHOD = {
  DIRECT: 'DIRECT',
  EQUAL: 'EQUAL',
  BY_WEIGHT: 'BY_WEIGHT',
  /** Gasto general de la finca (M7): sin asignaciones; no entra en la inversión por animal. */
  GENERAL: 'GENERAL',
} as const;
export type AllocationMethod = (typeof ALLOCATION_METHOD)[keyof typeof ALLOCATION_METHOD];

/** Método de avalúo. */
export const VALUATION_METHOD = {
  MANUAL: 'MANUAL',
  PRICE_PER_KG: 'PRICE_PER_KG',
} as const;
export type ValuationMethod = (typeof VALUATION_METHOD)[keyof typeof VALUATION_METHOD];

/** Estado de una jornada de manejo. */
export const WORK_SESSION_STATUS = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
} as const;
export type WorkSessionStatus = (typeof WORK_SESSION_STATUS)[keyof typeof WORK_SESSION_STATUS];

/** Acción registrada en la auditoría. */
export const AUDIT_ACTION = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  ARCHIVE: 'ARCHIVE',
  RESTORE: 'RESTORE',
  VOID: 'VOID',
  EXIT: 'EXIT',
  REVERT_EXIT: 'REVERT_EXIT',
  LOGIN: 'LOGIN',
  IMPORT: 'IMPORT',
  REVOKE_SESSIONS: 'REVOKE_SESSIONS',
} as const;
export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];

// --- Derivados: no existen como enum en Prisma porque se calculan (RN-16) ---

/** Categoría de manejo, exclusiva por animal activo (RN-06, 08 §2.1). */
export const MANAGEMENT_CATEGORY = {
  CALF_MALE: 'CALF_MALE',
  CALF_FEMALE: 'CALF_FEMALE',
  HEIFER: 'HEIFER',
  COW: 'COW',
  YOUNG_MALE: 'YOUNG_MALE',
  ADULT_MALE: 'ADULT_MALE',
} as const;
export type ManagementCategory = (typeof MANAGEMENT_CATEGORY)[keyof typeof MANAGEMENT_CATEGORY];

/** Etiquetas derivadas, combinables (08 §2.1). Las manuales viven en la tabla `tags`. */
export const DERIVED_TAG = {
  SERVED: 'SERVED',
  PREGNANT: 'PREGNANT',
  CALVED: 'CALVED',
  DRY: 'DRY',
  WITHDRAWAL: 'WITHDRAWAL',
} as const;
export type DerivedTag = (typeof DERIVED_TAG)[keyof typeof DERIVED_TAG];

/**
 * Estado del animal en el inventario (CLS-03). Archivado manda sobre la salida: un animal
 * archivado no aparece en ningún listado, haya salido o no (ANI-03).
 */
export const ANIMAL_STATUS = {
  ACTIVE: 'ACTIVE',
  /** Salida por venta: «Vendido». */
  SOLD: 'SOLD',
  /** Cualquier otra salida: «Retirado». */
  RETIRED: 'RETIRED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type AnimalStatus = (typeof ANIMAL_STATUS)[keyof typeof ANIMAL_STATUS];

/**
 * Alertas activas de un animal (ANI-06, ANI-07). Los valores son los del filtro `alerts` de
 * `GET /animals` (05-api.md).
 */
export const ANIMAL_ALERT = {
  /** Alguna vacuna vencida según `vaccineStatus` (RN-13). */
  VACCINE_OVERDUE: 'vaccine_overdue',
  /** Alguna vacuna pendiente o próxima según `vaccineStatus` (RN-13). */
  VACCINE_DUE: 'vaccine_due',
  /** Preñez confirmada con parto previsto dentro de la ventana de alerta de la finca. */
  CALVING_SOON: 'calving_soon',
  /** Período de retiro de medicamento vigente (RN-22). */
  WITHDRAWAL: 'withdrawal',
  /** Servida hace más de `unconfirmedServiceAlertDays` sin diagnóstico (RN-08). */
  UNCONFIRMED_SERVICE: 'unconfirmed_service',
  /**
   * Parto vencido sin registrar: preñez abierta cuyo parto estimado pasó hace más de
   * `overdueCalvingAlertDays` (M5).
   */
  CALVING_OVERDUE: 'calving_overdue',
  /**
   * Ganancia de los últimos 90 días menor que el umbral de su categoría (PES-05 CA2, M6;
   * ADR-015).
   */
  LOW_GAIN: 'low_gain',
  /** El último pesaje es menor que el anterior en más de `weightLossAlertPercent` (PES-05 CA3). */
  WEIGHT_LOSS: 'weight_loss',
} as const;
export type AnimalAlert = (typeof ANIMAL_ALERT)[keyof typeof ANIMAL_ALERT];

/** Grupos de edad del reporte ICA (08 §2.2). `OVER_3Y` es solo de machos; `Y3_TO_5` y `OVER_5Y`, solo de hembras. */
export const ICA_AGE_GROUP = {
  UNDER_3M: 'UNDER_3M',
  M3_TO_9: 'M3_TO_9',
  M9_TO_12: 'M9_TO_12',
  Y1_TO_2: 'Y1_TO_2',
  Y2_TO_3: 'Y2_TO_3',
  Y3_TO_5: 'Y3_TO_5',
  OVER_5Y: 'OVER_5Y',
  OVER_3Y: 'OVER_3Y',
} as const;
export type IcaAgeGroup = (typeof ICA_AGE_GROUP)[keyof typeof ICA_AGE_GROUP];
