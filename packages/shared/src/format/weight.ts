/**
 * Formato de peso para la interfaz: kilogramos con coma decimal (SRS §2 R1).
 * Los ceros finales se omiten: `"425.00"` → `425 kg`, `"425.50"` → `425,5 kg`.
 */

import { formatDecimalEsCo } from './number.js';

/** Opciones de `formatWeight`. */
export type FormatWeightOptions = {
  /** Agregar ` kg`. Por defecto, `true`. */
  readonly unit?: boolean;
  /** Decimales máximos. Por defecto, 2 (el mismo que `numeric(7,2)`). */
  readonly maxDecimals?: number;
};

/** `"425.50"` → `"425,5 kg"`. Acepta la cadena de la API o un número. */
export function formatWeight(value: string | number, options: FormatWeightOptions = {}): string {
  const text = typeof value === 'number' ? value.toFixed(2) : value.trim();
  const formatted = formatDecimalEsCo(text, options.maxDecimals ?? 2, true);
  return (options.unit ?? true) ? `${formatted} kg` : formatted;
}
