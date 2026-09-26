/**
 * Códigos sugeridos para las crías (RN-28 y 08 §2.3).
 *
 * Patrón configurable en `Farm.settings.calfCodePattern`, por defecto `{YY}-{NNN}`.
 * Tokens: `{YYYY}` año completo · `{YY}` año en dos dígitos · `{NNN}` consecutivo del año
 * con ceros a la izquierda · `{N}` consecutivo sin ceros.
 */

import { DomainError } from '../errors.js';

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
  const codes = new Set(input.existingCodes);
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
  while (codes.has(candidate)) {
    sequence += 1;
    candidate = formatCalfCode(input.pattern, input.year, sequence);
  }
  return candidate;
}
