import type {
  AllocationMethod,
  AnimalAlert,
  AnimalStatus,
  DerivedTag,
  ExpenseType,
  IdentifierType,
  ManagementCategory,
  Origin,
  Sex,
  ValuationMethod,
} from '../enums.js';

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
