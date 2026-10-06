import type { CalfHealth, DiagnosisResult } from '@hato/shared';

/** Textos del control reproductivo en el vocabulario del ganadero (06 §7). */

export { CALVING_TYPE_LABEL, SERVICE_METHOD_LABEL } from '@hato/shared';

export const CALF_HEALTH_LABEL: Readonly<Record<CalfHealth, string>> = {
  ALIVE: 'Sana',
  WEAK: 'Débil',
  STILLBORN: 'Muerta',
};

export const DIAGNOSIS_RESULT_LABEL: Readonly<Record<DiagnosisResult, string>> = {
  POSITIVE: 'Preñada',
  NEGATIVE: 'Vacía',
};

export { PREGNANCY_OUTCOME_LABEL as OUTCOME_LABEL } from '@hato/shared';

/** «1 cría», «2 crías». */
export function calvesText(count: number): string {
  return count === 1 ? '1 cría' : `${count} crías`;
}
