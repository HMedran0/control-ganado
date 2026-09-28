/**
 * Nombre legible del equipo a partir del `userAgent` (AUT-11 CA1): «Chrome · Android».
 *
 * Es un reconocedor propio y mínimo a propósito: basta con el navegador y el sistema, y las
 * librerías completas o son pesadas o tienen licencias que no sirven aquí (ua-parser-js v2 es
 * AGPL). El orden de las reglas importa, porque casi todos los navegadores se presentan también
 * como Chrome y Safari: primero los más específicos.
 */

const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\b(?:OPR|Opera)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/\bAndroid\b/, 'Android'],
  [/\b(?:iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bLinux\b/, 'Linux'],
];

/** Texto para cuando no se reconoce nada (o no llegó `userAgent`). */
export const UNKNOWN_DEVICE = 'Equipo desconocido';

function firstMatch(value: string, rules: readonly (readonly [RegExp, string])[]): string | null {
  for (const [pattern, name] of rules) {
    if (pattern.test(value)) return name;
  }
  return null;
}

/** «Chrome · Android», «Edge · Windows», «Firefox» o «Equipo desconocido». */
export function describeUserAgent(userAgent: string | null | undefined): string {
  if (userAgent === null || userAgent === undefined || userAgent.trim() === '') {
    return UNKNOWN_DEVICE;
  }
  const browser = firstMatch(userAgent, BROWSERS);
  const system = firstMatch(userAgent, SYSTEMS);
  if (browser === null && system === null) return UNKNOWN_DEVICE;
  return [browser, system].filter((part) => part !== null).join(' · ');
}
