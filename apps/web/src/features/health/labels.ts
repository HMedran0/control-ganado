import type { BulkVaccinationSkip, VaccineStatusKind } from '@hato/shared';

/** Textos de la sanidad (06 §7). */

export const VACCINE_STATUS_LABEL: Readonly<Record<VaccineStatusKind, string>> = {
  NOT_APPLICABLE: 'No aplica',
  UP_TO_DATE: 'Al día',
  PENDING: 'Pendiente',
  UPCOMING: 'Próxima',
  OVERDUE: 'Vencida',
};

/** Por qué un animal no se vacuna en un registro por lote (SAN-03). */
export const BULK_SKIP_LABEL: Readonly<Record<BulkVaccinationSkip, string>> = {
  NOT_ACTIVE: 'Ya no está en la finca',
  SEX_BLOCKED: 'La vacuna no se aplica a su sexo',
  BEFORE_BIRTH_OR_ENTRY: 'No había nacido o no estaba en la finca en esa fecha',
  ALREADY_IN_CYCLE: 'Ya la tiene en este ciclo',
  ALREADY_ON_DATE: 'Ya la tiene registrada ese día',
};
