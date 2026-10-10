import type {
  AllocationMethod,
  AnimalAlert,
  AnimalStatus,
  AuditAction,
  BirthCondition,
  BreedGroup,
  CalvingType,
  DerivedTag,
  ExitType,
  ExpenseType,
  IcaAgeGroup,
  IdentifiedBy,
  IdentifierRetireReason,
  IdentifierType,
  ImportKind,
  ManagementCategory,
  Origin,
  PregnancyOutcome,
  RfidCarrier,
  Role,
  ScaleFileFormat,
  ServiceMethod,
  Sex,
  ValuationMethod,
  VaccineScheduleType,
  WeightMethod,
  WeightSource,
  WorkSessionStatus,
} from '../enums.js';
import type { ReportName } from '../domain/reports.js';
import type { VaccineStatusKind } from '../domain/vaccination.js';

/**
 * Textos de los valores del dominio, con el vocabulario del ganadero (06 §7 y glosario del SRS
 * §1.4). Los usan la interfaz y los archivos que genera la API (exportación a Excel), para que
 * digan lo mismo.
 */

export const SEX_LABEL: Readonly<Record<Sex, string>> = { FEMALE: 'Hembra', MALE: 'Macho' };

export const CATEGORY_LABEL: Readonly<Record<ManagementCategory, string>> = {
  CALF_MALE: 'Ternero',
  CALF_FEMALE: 'Ternera',
  HEIFER: 'Novilla',
  COW: 'Vaca',
  YOUNG_MALE: 'Levante',
  ADULT_MALE: 'Toro',
};

export const DERIVED_TAG_LABEL: Readonly<Record<DerivedTag, string>> = {
  SERVED: 'Servida',
  PREGNANT: 'Preñada',
  CALVED: 'Parida',
  DRY: 'Horra',
  WITHDRAWAL: 'En retiro',
};

export const ALERT_LABEL: Readonly<Record<AnimalAlert, string>> = {
  vaccine_overdue: 'Vacuna vencida',
  vaccine_due: 'Vacuna pendiente',
  calving_soon: 'Parto próximo',
  withdrawal: 'En retiro',
  unconfirmed_service: 'Servida sin diagnóstico',
  calving_overdue: 'Parto vencido sin registrar',
  low_gain: 'Ganancia baja',
  weight_loss: 'Perdió peso',
};

export const STATUS_LABEL: Readonly<Record<AnimalStatus, string>> = {
  ACTIVE: 'Activo',
  SOLD: 'Vendido',
  RETIRED: 'Retirado',
  ARCHIVED: 'Archivado',
};

export const ORIGIN_LABEL: Readonly<Record<Origin, string>> = {
  BORN_ON_FARM: 'Nació en la finca',
  PURCHASED: 'Comprado',
};

export const IDENTIFIER_TYPE_LABEL: Readonly<Record<IdentifierType, string>> = {
  VISUAL_TAG: 'Chapeta',
  DIN: 'DIN',
  RFID: 'Chip',
  QR: 'QR',
  BRAND: 'Hierro',
  OTHER: 'Otro',
};

/** Tipos de gasto (ECO-01). */
export const EXPENSE_TYPE_LABEL: Readonly<Record<ExpenseType, string>> = {
  PURCHASE: 'Compra',
  FEED: 'Alimentación',
  MEDICATION: 'Medicamentos',
  VACCINE: 'Vacunas',
  VETERINARY: 'Veterinario',
  TRANSPORT: 'Transporte',
  OTHER: 'Otro',
};

/** A quién se carga un gasto (ECO-01, ECO-02). */
export const ALLOCATION_METHOD_LABEL: Readonly<Record<AllocationMethod, string>> = {
  DIRECT: 'Un animal',
  EQUAL: 'Partes iguales',
  BY_WEIGHT: 'Según el peso',
  GENERAL: 'Gasto general',
};

/** Cómo se calculó un avalúo (ECO-03). */
export const VALUATION_METHOD_LABEL: Readonly<Record<ValuationMethod, string>> = {
  MANUAL: 'A mano',
  PRICE_PER_KG: 'Peso × precio por kilo',
};

// Desde M8b, también los textos que antes vivían solo en la web: la exportación completa
// (BAK-02) y los reportes en Excel (RPT-02) dicen lo mismo que la pantalla.

/** Nombre de cada rol (glosario del SRS §2.2). */
export const ROLE_LABEL: Readonly<Record<Role, string>> = {
  ADMIN: 'Administrador',
  OPERATOR: 'Operario',
  VET: 'Veterinario',
};

/** Tipo de salida de la finca (ANI-08). */
export const EXIT_TYPE_LABEL: Readonly<Record<ExitType, string>> = {
  SALE: 'Venta',
  DEATH: 'Muerte',
  SLAUGHTER: 'Sacrificio',
  THEFT: 'Robo',
  TRANSFER: 'Traslado a otra finca',
  OTHER: 'Otra salida',
};

/** Por qué se retiró un identificador (IDN-06). */
export const RETIRE_REASON_LABEL: Readonly<Record<IdentifierRetireReason, string>> = {
  LOST: 'Pérdida',
  DAMAGED: 'Daño',
  REASSIGNED: 'Reasignación oficial',
  EXITED: 'Liberada al salir de la finca',
  ARCHIVED: 'Retirado al archivar el animal',
  OTHER: 'Otro motivo',
};

export const SERVICE_METHOD_LABEL: Readonly<Record<ServiceMethod, string>> = {
  NATURAL: 'Monta natural',
  AI: 'Inseminación',
  UNKNOWN: 'Sin servicio conocido',
};

export const CALVING_TYPE_LABEL: Readonly<Record<CalvingType, string>> = {
  NORMAL: 'Normal',
  ASSISTED: 'Asistido',
  CESAREAN: 'Cesárea',
};

/** Desenlace de una preñez. */
export const PREGNANCY_OUTCOME_LABEL: Readonly<Record<PregnancyOutcome, string>> = {
  PENDING: 'Abierta',
  CALVED: 'Parto',
  ABORTED: 'Aborto',
  FAILED: 'Vacía en la palpación',
};

/** Estado de la cría al nacer (NAC-01). */
export const BIRTH_CONDITION_LABEL: Readonly<Record<BirthCondition, string>> = {
  HEALTHY: 'Sana',
  WEAK: 'Débil',
};

export const WEIGHT_METHOD_LABEL: Readonly<Record<WeightMethod, string>> = {
  SCALE: 'Báscula',
  TAPE: 'Cinta',
  ESTIMATE: 'Estimado',
};

export const IDENTIFIED_BY_LABEL: Readonly<Record<IdentifiedBy, string>> = {
  SEARCH: 'Búsqueda',
  RFID_READER: 'Lector de chip',
  QR: 'QR',
  IMPORT: 'Archivo de la báscula',
};

export const WEIGHT_SOURCE_LABEL: Readonly<Record<WeightSource, string>> = {
  MANUAL: 'Digitado',
  SCALE_FILE: 'Archivo de la báscula',
  SCALE_LIVE: 'Báscula en vivo',
};

/** Grupo racial (08 §1.4). */
export const BREED_GROUP_LABEL: Readonly<Record<BreedGroup, string>> = {
  INDICUS: 'Cebuino',
  TAURUS: 'Europeo',
  CROSS: 'Cruce',
};

/** Programación de una vacuna (08 §1.5). */
export const VACCINE_SCHEDULE_LABEL: Readonly<Record<VaccineScheduleType, string>> = {
  OFFICIAL_CYCLE: 'Ciclo oficial',
  AGE_WINDOW: 'Por edad',
  INTERVAL: 'Por intervalo',
  NONE: 'Sin alerta',
};

export const WORK_SESSION_STATUS_LABEL: Readonly<Record<WorkSessionStatus, string>> = {
  OPEN: 'Abierta',
  CLOSED: 'Cerrada',
};

export const IMPORT_KIND_LABEL: Readonly<Record<ImportKind, string>> = {
  ANIMALS: 'Inventario',
  WEIGHTS: 'Pesaje de la báscula',
};

export const SCALE_FILE_FORMAT_LABEL: Readonly<Record<ScaleFileFormat, string>> = {
  CSV: 'CSV',
  XLSX: 'Excel',
};

/** Acción de la auditoría (AUD-01), como sustantivo para una columna. */
export const AUDIT_ACTION_LABEL: Readonly<Record<AuditAction, string>> = {
  CREATE: 'Registro',
  UPDATE: 'Cambio',
  ARCHIVE: 'Archivo',
  RESTORE: 'Restauración',
  VOID: 'Anulación',
  EXIT: 'Salida',
  REVERT_EXIT: 'Reversión de salida',
  LOGIN: 'Inicio de sesión',
  IMPORT: 'Importación',
  REVOKE_SESSIONS: 'Cierre de sesiones',
  EXPORT: 'Exportación completa',
};

/** Estado de una vacuna para un animal (SAN-04). */
export const VACCINE_STATUS_LABEL: Readonly<Record<VaccineStatusKind, string>> = {
  NOT_APPLICABLE: 'No aplica',
  UP_TO_DATE: 'Al día',
  PENDING: 'Pendiente',
  UPCOMING: 'Próxima',
  OVERDUE: 'Vencida',
};

/** Grupos de edad del formato ICA (08 §2.2). */
export const ICA_AGE_GROUP_LABEL: Readonly<Record<IcaAgeGroup, string>> = {
  UNDER_3M: 'Menos de 3 meses',
  M3_TO_9: '3 a 9 meses',
  M9_TO_12: '9 a 12 meses',
  Y1_TO_2: '1 a 2 años',
  Y2_TO_3: '2 a 3 años',
  Y3_TO_5: '3 a 5 años',
  OVER_5Y: 'Más de 5 años',
  OVER_3Y: 'Más de 3 años',
};

/** Nombre y para qué sirve cada reporte (RPT-02, 06 §5.19). */
export const REPORT_LABEL: Readonly<
  Record<ReportName, { readonly title: string; readonly description: string }>
> = {
  inventory: {
    title: 'Inventario',
    description: 'Animales activos por sexo, categoría, raza y lote.',
  },
  'inventory-ica': {
    title: 'Grupos de edad (formato ICA)',
    description: 'Hembras y machos por grupo de edad, para trámites y ciclos de vacunación.',
  },
  'cycle-progress': {
    title: 'Avance del ciclo de vacunación',
    description: 'Cuántos se vacunaron y cuántos faltan de cada vacuna del ciclo.',
  },
  births: {
    title: 'Nacimientos',
    description:
      'Por período: machos, hembras, débiles y muertos al nacer, con la madre de cada cría.',
  },
  vaccinations: {
    title: 'Vacunados',
    description: 'Vacunas aplicadas en un período, por vacuna.',
  },
  'vaccination-pending': {
    title: 'Pendientes de vacunación',
    description: 'Animales con vacunas vencidas, pendientes o próximas.',
  },
  'calvings-upcoming': {
    title: 'Partos próximos',
    description: 'Preñadas que paren pronto o ya debían parir, por fecha estimada.',
  },
  exits: {
    title: 'Vendidos y retirados',
    description: 'Salidas de la finca en un período: ventas, muertes y demás.',
  },
  economic: {
    title: 'Reporte económico',
    description: 'Gastos, ventas, inversión del hato y resultado de los vendidos.',
  },
};

/** Dónde va el chip, como se muestra en la ficha: «Chip inyectable · 982000123456789». */
export const RFID_CARRIER_LABEL: Readonly<Record<RfidCarrier, string>> = {
  EAR_TAG: 'Chip en arete',
  INJECTABLE: 'Chip inyectable',
  BOLUS: 'Bolo ruminal',
};

/** Las opciones de «Dónde va el chip» en formularios y en la plantilla de importación. */
export const RFID_CARRIER_CHOICE: Readonly<Record<RfidCarrier, string>> = {
  EAR_TAG: 'Arete',
  INJECTABLE: 'Inyectable',
  BOLUS: 'Bolo',
};
