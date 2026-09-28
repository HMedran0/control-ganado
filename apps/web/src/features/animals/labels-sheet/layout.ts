/**
 * Cuadrícula de la hoja de etiquetas (IDN-03 CA2), en milímetros: tamaño carta (el de las
 * papelerías en Colombia) o A4, y dos formatos: tarjetas de manejo 2 × 4 o etiquetas 3 × 7.
 */

export type Paper = 'letter' | 'a4';
export type LabelFormat = 'card' | 'label';

export const PAPERS: Readonly<
  Record<Paper, { label: string; width: number; height: number; css: string }>
> = {
  letter: { label: 'Carta', width: 215.9, height: 279.4, css: 'letter' },
  a4: { label: 'A4', width: 210, height: 297, css: 'A4' },
};

export const FORMATS: Readonly<
  Record<LabelFormat, { label: string; columns: number; rows: number }>
> = {
  card: { label: 'Tarjetas (2 × 4)', columns: 2, rows: 4 },
  label: { label: 'Etiquetas (3 × 7)', columns: 3, rows: 7 },
};

/** Margen de la hoja: el que casi todas las impresoras respetan. */
export const MARGIN_MM = 10;

export type SheetLayout = {
  readonly columns: number;
  readonly rows: number;
  readonly perPage: number;
  /** Área útil de la hoja, sin márgenes. */
  readonly widthMm: number;
  readonly heightMm: number;
  readonly cellWidthMm: number;
  readonly cellHeightMm: number;
};

export function sheetLayout(paper: Paper, format: LabelFormat): SheetLayout {
  const { width, height } = PAPERS[paper];
  const { columns, rows } = FORMATS[format];
  const widthMm = width - 2 * MARGIN_MM;
  const heightMm = height - 2 * MARGIN_MM;
  return {
    columns,
    rows,
    perPage: columns * rows,
    widthMm,
    heightMm,
    cellWidthMm: widthMm / columns,
    cellHeightMm: heightMm / rows,
  };
}

/** Reparte las etiquetas en hojas. */
export function paginate<T>(items: readonly T[], perPage: number): T[][] {
  const pages: T[][] = [];
  for (let start = 0; start < items.length; start += perPage) {
    pages.push(items.slice(start, start + perPage));
  }
  return pages;
}

/** «21 etiquetas · 1 hoja». */
export function sheetSummary(count: number, pages: number): string {
  return `${count.toLocaleString('es-CO')} ${count === 1 ? 'etiqueta' : 'etiquetas'} · ${pages.toLocaleString('es-CO')} ${pages === 1 ? 'hoja' : 'hojas'}`;
}
