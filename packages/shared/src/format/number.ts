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

/** Enteros con puntos de miles bien puestos: `1.250.000`, `250`, `12.000`. */
const GROUPED_INTEGER = /^\d{1,3}(?:\.\d{3})+$/;

/** Espacios (también el duro de `Intl`) y el signo de pesos que la gente escribe o pega. */
const DECORATION = /[\s\u00a0\u202f$]/g;

/**
 * Interpreta un número escrito en es-CO y lo devuelve como cadena decimal normalizada
 * (`"452.5"`, `"1250000"`), o `null` si no es un número válido.
 *
 * Devuelve texto y no `number` a propósito: el dinero no puede pasar por coma flotante
 * (CLAUDE.md, regla 7), y un peso tampoco gana nada con ello.
 *
 * Reglas (RNF-13: coma decimal, punto de miles):
 * - La coma es siempre el separador decimal, y el punto, el de miles: `"452,5"` → `"452.5"`,
 *   `"1.250.000"` → `"1250000"`. Los puntos de miles tienen que estar bien agrupados.
 * - Con decimales permitidos (`maxDecimals > 0`) y **sin coma**, un único punto seguido de 1 o
 *   2 dígitos se toma como decimal (`"452.5"` → `"452.5"`): algunos teclados numéricos del
 *   celular solo tienen punto. Un punto seguido de 3 dígitos sigue siendo de miles
 *   (`"1.250"` → `"1250"`).
 * - Con `maxDecimals = 0` (dinero en pesos), el punto es **siempre** de miles: `"1.25"` no
 *   puede significar un peso con veinticinco centavos, así que es `"125"`.
 * - No acepta signo negativo: pesos, cantidades y precios nunca lo son.
 * - Si hay más decimales de los permitidos (sin contar ceros a la derecha), es inválido: se
 *   rechaza en lugar de redondear un valor que la persona no escribió.
 *
 * @param text Lo que escribió la persona. Admite `$` y espacios, que se ignoran.
 * @param maxDecimals Decimales permitidos: 0 para pesos, 1 o 2 para kilos.
 */
export function parseDecimalEsCo(text: string, maxDecimals: number): string | null {
  const clean = text.replace(DECORATION, '');
  if (clean === '' || !/^[\d.,]+$/.test(clean)) return null;

  let whole: string;
  let fraction = '';

  const commas = clean.split(',').length - 1;
  if (commas > 1) return null;

  if (commas === 1) {
    const [left = '', right = ''] = clean.split(',');
    if (right === '' || right.includes('.')) return null;
    whole = ungroup(left);
    fraction = right;
    if (left === '') whole = '0';
  } else if (!clean.includes('.')) {
    whole = clean;
  } else if (maxDecimals > 0 && /^\d+\.\d{1,2}$/.test(clean)) {
    [whole = '', fraction = ''] = clean.split('.');
  } else if (maxDecimals === 0 && /^\d+(?:\.\d+)+$/.test(clean)) {
    // En pesos no hay decimales: los puntos se descartan aunque estén mal agrupados.
    whole = clean.replace(/\./g, '');
  } else {
    whole = ungroup(clean);
  }

  if (whole === '' || !/^\d+$/.test(whole)) return null;

  fraction = fraction.replace(/0+$/, '');
  if (fraction.length > maxDecimals) return null;

  whole = whole.replace(/^0+(?=\d)/, '');
  return fraction === '' ? whole : `${whole}.${fraction}`;
}

/** Quita los puntos de miles; `''` si están mal agrupados (`"1.25.0"`). */
function ungroup(value: string): string {
  if (!value.includes('.')) return value;
  return GROUPED_INTEGER.test(value) ? value.replace(/\./g, '') : '';
}
