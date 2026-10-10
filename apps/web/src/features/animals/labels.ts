import type {
  AnimalStatus,
  DerivedTag,
  IdentifierType,
  ManagementCategory,
  Sex,
  WeightMethod,
  RfidCarrier,
} from '@hato/shared';

import {
  RFID_CARRIER_LABEL,
  ALERT_LABEL,
  CATEGORY_LABEL,
  DERIVED_TAG_LABEL,
  IDENTIFIER_TYPE_LABEL,
  ORIGIN_LABEL,
  SEX_LABEL,
  STATUS_LABEL,
} from '@hato/shared';

import type { TagTone } from '../../components/ui/Tag';

// Los textos de los valores del dominio viven en shared: la exportación a Excel de la API dice
// lo mismo que la pantalla.
export {
  ALERT_LABEL,
  CATEGORY_LABEL,
  DERIVED_TAG_LABEL,
  IDENTIFIER_TYPE_LABEL,
  ORIGIN_LABEL,
  SEX_LABEL,
  STATUS_LABEL,
};

/**
 * Textos de la interfaz de animales, con el vocabulario del ganadero (06 §7 y glosario del
 * SRS §1.4). El código y la API hablan en inglés; la pantalla, en español de Colombia.
 */

export const SEX_FILTER_LABEL: Readonly<Record<Sex, string>> = {
  FEMALE: 'Hembras',
  MALE: 'Machos',
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

export { RETIRE_REASON_LABEL } from '@hato/shared';

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
export function identifierText(
  type: IdentifierType,
  value: string,
  carrier: RfidCarrier | null = null,
): string {
  const shown =
    type === 'RFID' && value.length === 15 ? `${value.slice(0, 3)} ${value.slice(3)}` : value;
  // «Chip inyectable 982 000123456789»: dónde va el chip, si se indicó (ajuste previo de M9).
  const name =
    type === 'RFID' && carrier !== null ? RFID_CARRIER_LABEL[carrier] : IDENTIFIER_TYPE_LABEL[type];
  return `${name} ${shown}`;
}
