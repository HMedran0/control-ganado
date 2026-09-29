import type {
  CalfHealth,
  CalvingType,
  DiagnosisResult,
  PregnancyOutcome,
  ServiceMethod,
} from '@hato/shared';

/** Textos del control reproductivo en el vocabulario del ganadero (06 §7). */

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

export const CALF_HEALTH_LABEL: Readonly<Record<CalfHealth, string>> = {
  ALIVE: 'Sana',
  WEAK: 'Débil',
  STILLBORN: 'Muerta',
};

export const DIAGNOSIS_RESULT_LABEL: Readonly<Record<DiagnosisResult, string>> = {
  POSITIVE: 'Preñada',
  NEGATIVE: 'Vacía',
};

export const OUTCOME_LABEL: Readonly<Record<PregnancyOutcome, string>> = {
  PENDING: 'Abierta',
  CALVED: 'Parto',
  ABORTED: 'Aborto',
  FAILED: 'Vacía en la palpación',
};

/** «1 cría», «2 crías». */
export function calvesText(count: number): string {
  return count === 1 ? '1 cría' : `${count} crías`;
}
