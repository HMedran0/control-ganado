import type {
  IdentifiedBy,
  ScaleMatchVia,
  ScaleRowStatus,
  WeightMethod,
  WeightSource,
} from '@hato/shared';

/** Textos de los pesos y la báscula (06 §7). */

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

/** Cómo se asoció cada fila del archivo (PES-04, decisión de M6). */
export const SCALE_VIA_LABEL: Readonly<Record<ScaleMatchVia, string>> = {
  RFID: 'Por chip',
  VISUAL_TAG: 'Por chapeta',
  CODE: 'Por código',
  ASSOCIATED: 'Asociado a mano',
};

export const SCALE_ROW_STATUS_LABEL: Readonly<Record<ScaleRowStatus, string>> = {
  MATCHED: 'Se guarda',
  DUPLICATE: 'Repetido',
  UNKNOWN_CHIP: 'Chip desconocido',
  SKIPPED: 'No se importa',
  ERROR: 'Error',
};
