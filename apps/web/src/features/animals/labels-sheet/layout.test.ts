import { describe, expect, it } from 'vitest';

import { paginate, sheetLayout, sheetSummary } from './layout';

describe('hoja de etiquetas', () => {
  it('carta 3 × 7 y A4 2 × 4, con márgenes de 10 mm', () => {
    const letter = sheetLayout('letter', 'label');
    expect(letter).toMatchObject({ columns: 3, rows: 7, perPage: 21 });
    expect(letter.cellWidthMm).toBeCloseTo(65.3, 1);
    expect(letter.cellHeightMm).toBeCloseTo(37.06, 1);
    const a4 = sheetLayout('a4', 'card');
    expect(a4).toMatchObject({ columns: 2, rows: 4, perPage: 8, widthMm: 190, heightMm: 277 });
  });

  it('reparte en hojas y resume', () => {
    expect(paginate([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(paginate([], 21)).toEqual([]);
    expect(sheetSummary(22, 2)).toBe('22 etiquetas · 2 hojas');
    expect(sheetSummary(1, 1)).toBe('1 etiqueta · 1 hoja');
  });
});
