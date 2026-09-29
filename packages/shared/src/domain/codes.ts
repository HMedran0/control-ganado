/**
 * Códigos internos de los animales: normalización (RN-30), sugerencia por patrón para las crías
 * (RN-28, 08 §2.3) y número libre más bajo (ANI-10 CA2).
 *
 * Patrón configurable en `Farm.settings.calfCodePattern`, por defecto `{YY}-{NNN}`.
 * Tokens: `{YYYY}` año completo · `{YY}` año en dos dígitos · `{NNN}` consecutivo del año
 * con ceros a la izquierda · `{N}` consecutivo sin ceros.
 */

import { DomainError } from '../errors.js';

// ---------------------------------------------------------------------------------------------
// Normalización (RN-30)
// ---------------------------------------------------------------------------------------------

/**
 * Espacios que se quitan al inicio y al final de un código: espacio, tabulador, salto de línea
 * y espacio duro (U+00A0). Lista cerrada, idéntica a la de `hato_normalize_code` en SQL: los
 * «espacios» por defecto de `trim` en JavaScript y en PostgreSQL no coinciden entre sí.
 */
export const CODE_EDGE_WHITESPACE = [' ', '\t', '\n', ' '] as const;

/**
 * Minúsculas que se pasan a mayúsculas, en el mismo orden que `CODE_UPPERCASE`. Lista cerrada,
 * idéntica a la del `translate` de `hato_normalize_code`: `toUpperCase` y `upper()` dependen de
 * Unicode y de la configuración regional, y podrían diferir en letras raras.
 */
export const CODE_LOWERCASE = 'abcdefghijklmnopqrstuvwxyzñáéíóúü';
export const CODE_UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZÑÁÉÍÓÚÜ';

const EDGE_CLASS = `[${CODE_EDGE_WHITESPACE.map((char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).join('')}]`;
const EDGE_PATTERN = new RegExp(`^${EDGE_CLASS}+|${EDGE_CLASS}+$`, 'g');
const ASCII_DIGITS = /^[0-9]+$/;

/**
 * Código tal como se guarda: en forma NFC y sin los espacios de `CODE_EDGE_WHITESPACE` al inicio
 * ni al final. Conserva las mayúsculas y los ceros que escribió la persona.
 */
export function cleanAnimalCode(code: string): string {
  return code.normalize('NFC').replace(EDGE_PATTERN, '');
}

/**
 * Código normalizado para comparar (RN-30): `cleanAnimalCode`, las letras de `CODE_LOWERCASE`
 * en mayúsculas y, si es solo numérico, sin ceros a la izquierda («5», «05» y «005» son el mismo;
 * «000» es «0»). Es la misma función que `hato_normalize_code` en la base; una prueba de
 * integración lo comprueba caso por caso.
 */
export function normalizeAnimalCode(code: string): string {
  let upper = '';
  for (const char of cleanAnimalCode(code)) {
    const index = CODE_LOWERCASE.indexOf(char);
    upper += index === -1 ? char : CODE_UPPERCASE.charAt(index);
  }
  return ASCII_DIGITS.test(upper) ? upper.replace(/^0+(?=[0-9])/, '') : upper;
}

/**
 * Menor entero positivo que no está entre los códigos dados (ANI-10 CA2). Los códigos que no son
 * numéricos no cuentan. Quien llama decide el conjunto: los animales activos si la finca
 * reutiliza números, todos los no archivados si no (ahí es donde se exige la unicidad).
 */
export function lowestFreeCode(codes: Iterable<string>): string {
  const used = new Set<string>();
  for (const code of codes) used.add(normalizeAnimalCode(code));
  let candidate = 1;
  while (used.has(String(candidate))) candidate += 1;
  return String(candidate);
}

// ---------------------------------------------------------------------------------------------
// Patrón de las crías (RN-28)
// ---------------------------------------------------------------------------------------------

/** Patrón por defecto (08 §2.3). */
export const DEFAULT_CALF_CODE_PATTERN = '{YY}-{NNN}';

const TOKEN_PATTERN = /\{(YYYY|YY|NNN|N)\}/g;

/** ¿El patrón tiene al menos un token de consecutivo, que es lo que lo hace único? */
export function isValidCalfCodePattern(pattern: string): boolean {
  return /\{NNN\}|\{N\}/.test(pattern);
}

/**
 * Aplica el patrón a un año y un consecutivo.
 * @throws {DomainError} `VALIDATION_FAILED` si el patrón no tiene `{NNN}` ni `{N}`.
 */
export function formatCalfCode(pattern: string, year: number, sequence: number): string {
  if (!isValidCalfCodePattern(pattern)) {
    throw new DomainError('VALIDATION_FAILED', {
      detail: `El patrón «${pattern}» debe incluir {NNN} o {N} para el consecutivo.`,
    });
  }
  return pattern.replace(TOKEN_PATTERN, (_match, token: string) => {
    switch (token) {
      case 'YYYY':
        return String(year).padStart(4, '0');
      case 'YY':
        return String(year % 100).padStart(2, '0');
      case 'NNN':
        return String(sequence).padStart(3, '0');
      default:
        return String(sequence);
    }
  });
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Expresión regular que reconoce los códigos de un año y captura su consecutivo.
 * Se construye a partir del patrón para no depender de un formato fijo.
 */
function sequencePattern(pattern: string, year: number): RegExp {
  let source = '';
  let lastIndex = 0;
  for (const match of pattern.matchAll(TOKEN_PATTERN)) {
    source += escapeForRegExp(pattern.slice(lastIndex, match.index));
    const token = match[1];
    if (token === 'YYYY') source += escapeForRegExp(String(year).padStart(4, '0'));
    else if (token === 'YY') source += escapeForRegExp(String(year % 100).padStart(2, '0'));
    else source += '(\\d+)';
    lastIndex = match.index + match[0].length;
  }
  source += escapeForRegExp(pattern.slice(lastIndex));
  return new RegExp(`^${source}$`);
}

/** Entrada de `suggestCodes`. */
export type SuggestCodesInput = {
  /** `Farm.settings.codeSuggestion` (ANI-10). */
  readonly suggestion: 'PATTERN' | 'LOWEST_FREE';
  /** `Farm.settings.calfCodePattern`. */
  readonly pattern: string;
  /** Año del consecutivo, normalmente el del nacimiento. */
  readonly year: number;
  /**
   * Códigos que ya cuentan: con `PATTERN`, todos los de la finca (RN-28); con `LOWEST_FREE`, los
   * del conjunto donde se exige la unicidad (ANI-10 CA2).
   */
  readonly existingCodes: Iterable<string>;
  /** Cuántos códigos distintos (mellizos: hasta 3). */
  readonly count: number;
};

/**
 * Varios códigos sugeridos y distintos entre sí, por ejemplo para las crías de un parto gemelar
 * (REP-04 CA3): cada uno se toma como ocupado antes de pedir el siguiente. Con `LOWEST_FREE` son
 * los menores números libres; con `PATTERN`, consecutivos del patrón.
 */
export function suggestCodes(input: SuggestCodesInput): string[] {
  const taken = [...input.existingCodes];
  const codes: string[] = [];
  for (let index = 0; index < input.count; index += 1) {
    const code =
      input.suggestion === 'LOWEST_FREE'
        ? lowestFreeCode(taken)
        : nextCalfCode({ pattern: input.pattern, year: input.year, existingCodes: taken });
    codes.push(code);
    taken.push(code);
  }
  return codes;
}

/** Entrada de `nextCalfCode`. */
export type NextCalfCodeInput = {
  /** `Farm.settings.calfCodePattern`. */
  readonly pattern: string;
  /** Año del consecutivo, normalmente el del nacimiento. */
  readonly year: number;
  /** Todos los códigos de la finca, activos y archivados (RN-28). */
  readonly existingCodes: Iterable<string>;
};

/**
 * Siguiente código libre para una cría (RN-28).
 *
 * Toma el consecutivo más alto ya usado en el año y sigue desde ahí; si el código resultante
 * ya existe (por ejemplo, porque alguien lo escribió a mano con otro patrón), avanza hasta
 * encontrar uno libre. Nunca reutiliza un código existente, ni siquiera de un animal
 * archivado, y por eso no rellena los huecos.
 */
export function nextCalfCode(input: NextCalfCodeInput): string {
  const codes = [...input.existingCodes];
  // Se compara normalizado (RN-30): «26-001» y «26-001 » son el mismo código.
  const taken = new Set(codes.map(normalizeAnimalCode));
  const matcher = sequencePattern(input.pattern, input.year);

  let highest = 0;
  for (const code of codes) {
    const match = matcher.exec(code);
    const captured = match?.[1];
    if (captured === undefined) continue;
    const sequence = Number(captured);
    if (sequence > highest) highest = sequence;
  }

  let candidate = formatCalfCode(input.pattern, input.year, highest + 1);
  let sequence = highest + 1;
  while (taken.has(normalizeAnimalCode(candidate))) {
    sequence += 1;
    candidate = formatCalfCode(input.pattern, input.year, sequence);
  }
  return candidate;
}
