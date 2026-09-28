import { importColumnLabel, type ImportIssue } from '@hato/shared';

/** Una fila del archivo con sus problemas, para la tabla de la simulación (06 §5.6). */
export type RowIssues = {
  readonly row: number;
  /** `error` si alguno es error: la fila no entra. */
  readonly severity: 'error' | 'warning';
  /** «Código madre: La madre 012 es macho.» */
  readonly messages: readonly string[];
};

export type IssueFilter = 'all' | 'error' | 'warning';

/** Agrupa los problemas por fila, en orden de fila. */
export function groupIssues(issues: readonly ImportIssue[]): RowIssues[] {
  const byRow = new Map<number, ImportIssue[]>();
  for (const issue of issues) byRow.set(issue.row, [...(byRow.get(issue.row) ?? []), issue]);
  return [...byRow.entries()]
    .sort(([left], [right]) => left - right)
    .map(([row, items]) => ({
      row,
      severity: items.some((item) => item.severity === 'error') ? 'error' : 'warning',
      messages: items.map((item) =>
        item.column === null ? item.message : `${importColumnLabel(item.column)}: ${item.message}`,
      ),
    }));
}

export function filterRows(rows: readonly RowIssues[], filter: IssueFilter): RowIssues[] {
  return filter === 'all' ? [...rows] : rows.filter((row) => row.severity === filter);
}

/** «Importar 1 animal», «Importar 271 animales». */
export function importButtonText(count: number): string {
  return `Importar ${count.toLocaleString('es-CO')} ${count === 1 ? 'animal' : 'animales'}`;
}

/** «11 animales importados · 1 fila por corregir» (06 §5.6, paso 3). */
export function resultText(created: number, skipped: number): string {
  const done = `${created.toLocaleString('es-CO')} ${created === 1 ? 'animal importado' : 'animales importados'}`;
  if (skipped === 0) return done;
  return `${done} · ${skipped.toLocaleString('es-CO')} ${skipped === 1 ? 'fila por corregir' : 'filas por corregir'}`;
}
