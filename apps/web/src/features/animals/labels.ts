import type {
  AnimalAlert,
  AnimalStatus,
  DerivedTag,
  IdentifierRetireReason,
  IdentifierType,
  ManagementCategory,
  Origin,
  Sex,
  WeightMethod,
} from '@hato/shared';

import type { TagTone } from '../../components/ui/Tag';

/**
 * Textos de la interfaz de animales, con el vocabulario del ganadero (06 §7 y glosario del
 * SRS §1.4). El código y la API hablan en inglés; la pantalla, en español de Colombia.
 */

export const SEX_LABEL: Readonly<Record<Sex, string>> = { FEMALE: 'Hembra', MALE: 'Macho' };
export const SEX_FILTER_LABEL: Readonly<Record<Sex, string>> = {
  FEMALE: 'Hembras',
  MALE: 'Machos',
};

export const CATEGORY_LABEL: Readonly<Record<ManagementCategory, string>> = {
  CALF_MALE: 'Ternero',
  CALF_FEMALE: 'Ternera',
  HEIFER: 'Novilla',
  COW: 'Vaca',
  YOUNG_MALE: 'Levante',
  ADULT_MALE: 'Toro',
};

/** En plural, para los filtros («Vacas», «Terneras»). */
export const CATEGORY_FILTER_LABEL: Readonly<Record<ManagementCategory, string>> = {
  CALF_MALE: 'Terneros',
  CALF_FEMALE: 'Terneras',
  HEIFER: 'Novillas',
  COW: 'Vacas',
  YOUNG_MALE: 'Levante',
  ADULT_MALE: 'Toros',
};

export const DERIVED_TAG_LABEL: Readonly<Record<DerivedTag, string>> = {
  SERVED: 'Servida',
  PREGNANT: 'Preñada',
  CALVED: 'Parida',
  DRY: 'Horra',
  WITHDRAWAL: 'En retiro',
};

export const DERIVED_TAG_FILTER_LABEL: Readonly<Record<DerivedTag, string>> = {
  SERVED: 'Servidas',
  PREGNANT: 'Preñadas',
  CALVED: 'Paridas',
  DRY: 'Horras',
  WITHDRAWAL: 'En retiro',
};

/** Color de cada etiqueta derivada; el texto siempre acompaña (06 §8). */
export const DERIVED_TAG_TONE: Readonly<Record<DerivedTag, TagTone>> = {
  SERVED: 'info',
  PREGNANT: 'info',
  CALVED: 'potrero',
  DRY: 'neutro',
  WITHDRAWAL: 'aviso',
};

export const ALERT_LABEL: Readonly<Record<AnimalAlert, string>> = {
  vaccine_overdue: 'Vacuna vencida',
  vaccine_due: 'Vacuna pendiente',
  calving_soon: 'Parto próximo',
  withdrawal: 'En retiro',
  unconfirmed_service: 'Servida sin diagnóstico',
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

export const RETIRE_REASON_LABEL: Readonly<Record<IdentifierRetireReason, string>> = {
  LOST: 'Pérdida',
  DAMAGED: 'Daño',
  REASSIGNED: 'Reasignación oficial',
  OTHER: 'Otro motivo',
};

export const WEIGHT_METHOD_LABEL: Readonly<Record<WeightMethod, string>> = {
  SCALE: 'báscula',
  TAPE: 'cinta',
  ESTIMATE: 'estimado',
};

/**
 * «Parida · 4 partos»: el número de partos acompaña a la etiqueta (CLS-01 CA2). En la tabla,
 * donde el ancho es escaso, «Parida · 4» (06 §5.2).
 */
export function derivedTagText(tag: DerivedTag, calvingCount: number, compact = false): string {
  if (tag !== 'CALVED') return DERIVED_TAG_LABEL[tag];
  if (compact) return `Parida · ${calvingCount}`;
  return `Parida · ${calvingCount} ${calvingCount === 1 ? 'parto' : 'partos'}`;
}

/** Etiqueta de salida para la Chapeta: «Vendido», «Retirado» (06 §6). */
export function exitLabelFor(status: AnimalStatus): string | undefined {
  if (status === 'SOLD' || status === 'RETIRED') return STATUS_LABEL[status];
  return undefined;
}

/** «1 animal», «63 animales». */
export function animalsCount(count: number): string {
  return `${count.toLocaleString('es-CO')} ${count === 1 ? 'animal' : 'animales'}`;
}

/** «Chip 170 000123456789»: el RFID se agrupa como se lee en el arete (06 §5.3). */
export function identifierText(type: IdentifierType, value: string): string {
  const shown =
    type === 'RFID' && value.length === 15 ? `${value.slice(0, 3)} ${value.slice(3)}` : value;
  return `${IDENTIFIER_TYPE_LABEL[type]} ${shown}`;
}
