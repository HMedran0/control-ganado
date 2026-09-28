import { describe, expect, it } from 'vitest';

import { escapeSpreadsheetText, looksLikeFormula } from './spreadsheet.js';

describe('escapeSpreadsheetText', () => {
  it.each(['=CMD("calc")', '+57 300', '-5', '@SUM(A1)', '\t=1', '\r=1'])('escapa «%s»', (value) => {
    expect(looksLikeFormula(value)).toBe(true);
    expect(escapeSpreadsheetText(value)).toBe(`'${value}`);
  });

  it('deja igual el texto normal', () => {
    for (const value of ['Canela', '087', '26-031', 'Toro =grande', '', ' =1']) {
      expect(escapeSpreadsheetText(value)).toBe(value);
    }
  });
});
