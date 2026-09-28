/**
 * Texto seguro para una celda de hoja de cálculo (exportación del listado y filas con error).
 *
 * Excel, LibreOffice y Google Sheets interpretan como fórmula el texto que empieza por `=`, `+`,
 * `-` o `@`, y algunos también tras un tabulador o un retorno de carro: un nombre como
 * «=HYPERLINK(…)» o «=CMD(…)» se ejecutaría al abrir el archivo (inyección de fórmulas, OWASP
 * «CSV injection»). Se antepone un apóstrofo, que las hojas muestran como texto y no imprimen.
 */

const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r']);

/** ¿El texto se interpretaría como fórmula? */
export function looksLikeFormula(value: string): boolean {
  return value.length > 0 && FORMULA_TRIGGERS.has(value.charAt(0));
}

/** El mismo texto, con un apóstrofo delante si empieza como una fórmula. */
export function escapeSpreadsheetText(value: string): string {
  return looksLikeFormula(value) ? `'${value}` : value;
}
