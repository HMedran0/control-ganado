import { describe, expect, it } from 'vitest';

import { parseSystemQr, systemQrUrl } from './qr.js';

const ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

describe('QR del sistema (IDN-03)', () => {
  it('la URL solo lleva la dirección pública y el id', () => {
    expect(systemQrUrl('https://hato.finca.co', ID)).toBe(`https://hato.finca.co/a/${ID}`);
    expect(systemQrUrl('https://hato.finca.co/', ID)).toBe(`https://hato.finca.co/a/${ID}`);
  });

  it('reconoce el contenido del QR, con o sin dominio, barra final o parámetros', () => {
    for (const text of [
      `https://hato.finca.co/a/${ID}`,
      ` http://localhost:5173/a/${ID.toUpperCase()}/ `,
      `/a/${ID}`,
      `a/${ID}?origen=qr`,
    ]) {
      expect(parseSystemQr(text), text).toBe(ID);
    }
  });

  it('lo demás no es un QR del sistema', () => {
    for (const text of [
      '087',
      ID,
      `https://otro.co/b/${ID}`,
      'https://hato.finca.co/a/123',
      `https://x/ba/${ID}`,
    ]) {
      expect(parseSystemQr(text), text).toBeNull();
    }
  });
});
