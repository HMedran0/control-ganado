/**
 * Agrupación de miles en es-CO (RNF-13: separador de miles con punto, decimal con coma).
 *
 * Implementado a mano en lugar de con `Intl.NumberFormat` a propósito: `Intl` inserta
 * espacios duros y su salida cambia entre versiones de ICU y entre Node y los navegadores,
 * lo que volvería frágiles las pruebas de formato que exige RNF-13.
 */

/** Inserta el punto de miles en una cadena de dígitos enteros. */
export function groupThousands(digits: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += '.';
    out += digits[i];
  }
  return out;
}

/**
 * Formatea un decimal en es-CO.
 *
 * @param value Cadena decimal (`"1250.50"`), sin notación científica.
 * @param maxDecimals Decimales máximos que se muestran.
 * @param trimZeros Si es `true`, quita los decimales que terminen en cero.
 */
export function formatDecimalEsCo(value: string, maxDecimals: number, trimZeros: boolean): string {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole = '0', fractionRaw = ''] = unsigned.split('.');

  let fraction = fractionRaw.slice(0, maxDecimals);
  if (trimZeros) fraction = fraction.replace(/0+$/, '');

  const sign = negative ? '-' : '';
  const grouped = groupThousands(whole.replace(/^0+(?=\d)/, ''));
  return fraction === '' ? `${sign}${grouped}` : `${sign}${grouped},${fraction}`;
}
