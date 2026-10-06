import type { ScaleMatchVia, ScaleRowStatus } from '@hato/shared';

/** Textos de los pesos y la báscula (06 §7). */

export { IDENTIFIED_BY_LABEL, WEIGHT_METHOD_LABEL, WEIGHT_SOURCE_LABEL } from '@hato/shared';

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
