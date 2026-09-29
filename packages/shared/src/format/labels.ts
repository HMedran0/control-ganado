import type {
  AnimalAlert,
  AnimalStatus,
  DerivedTag,
  IdentifierType,
  ManagementCategory,
  Origin,
  Sex,
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
