import { afterEach, describe, expect, it } from 'vitest';

import { recalledIdentification, rememberIdentification } from './identification';

const ID = '0199a1b2-0000-7000-8000-000000000001';

describe('cómo se identificó al animal (PES-01, PIL-05)', () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it('sin dato, por búsqueda', () => {
    expect(recalledIdentification(ID)).toBe('SEARCH');
  });

  it('recuerda el lector o el QR durante 30 minutos', () => {
    rememberIdentification(ID, 'RFID_READER', 1_000);
    expect(recalledIdentification(ID, 1_000 + 29 * 60_000)).toBe('RFID_READER');
    expect(recalledIdentification(ID, 1_000 + 31 * 60_000)).toBe('SEARCH');
    rememberIdentification(ID, 'QR', 5_000);
    expect(recalledIdentification(ID, 5_000)).toBe('QR');
  });

  it('un valor dañado cuenta como búsqueda', () => {
    sessionStorage.setItem(`hato:identificado:${ID}`, '{no es json');
    expect(recalledIdentification(ID)).toBe('SEARCH');
    sessionStorage.setItem(`hato:identificado:${ID}`, JSON.stringify({ by: 'IMPORT', at: 0 }));
    expect(recalledIdentification(ID, 0)).toBe('SEARCH');
  });
});
