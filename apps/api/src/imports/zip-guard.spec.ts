import { describe, expect, it } from 'vitest';

import { craftZip, zipBomb } from '../../test/helpers/crafted-files.js';
import {
  buildStoredZip,
  isSafeEntryName,
  looksLikeZip,
  readZipEntries,
  XLSX_ZIP_LIMITS,
  ZipRejected,
} from './zip-guard.js';

const SMALL = { maxTotalBytes: 1024 * 1024, maxEntries: 10 };

function rejection(buffer: Buffer, limits = SMALL): string {
  try {
    readZipEntries(buffer, limits);
  } catch (error) {
    if (error instanceof ZipRejected) return error.reason;
    throw error;
  }
  throw new Error('Se esperaba que el ZIP se rechazara.');
}

describe('readZipEntries', () => {
  it('lee entradas guardadas y comprimidas', () => {
    const zip = craftZip([
      { name: 'a.xml', data: '<a/>', method: 'store' },
      { name: 'xl/b.xml', data: 'b'.repeat(10_000) },
      { name: 'xl/', data: '', method: 'store' },
    ]);
    const entries = readZipEntries(zip, SMALL);
    expect(entries.map((entry) => [entry.name, entry.data.length])).toEqual([
      ['a.xml', 4],
      ['xl/b.xml', 10_000],
    ]);
  });

  it('una bomba pequeña se corta al descomprimir, aunque declare un tamaño de 10 bytes', () => {
    const bomb = zipBomb(20);
    expect(bomb.length).toBeLessThan(100 * 1024);
    expect(rejection(bomb)).toContain('se infla más de lo permitido');
    expect(rejection(zipBomb(60), XLSX_ZIP_LIMITS)).toContain('se infla más de lo permitido');
  });

  it('el presupuesto es la suma de todas las entradas', () => {
    const zip = craftZip([
      { name: 'a', data: Buffer.alloc(600 * 1024) },
      { name: 'b', data: Buffer.alloc(600 * 1024) },
    ]);
    expect(rejection(zip)).toMatch(/supera el límite|se infla más/);
  });

  it.each(['../evil.xml', 'xl/../../evil.xml', '/etc/passwd', 'C:/Windows/x', 'xl\\evil.xml'])(
    'rechaza el nombre %s',
    (name) => {
      expect(rejection(craftZip([{ name, data: 'x' }]))).toContain('nombre de entrada inseguro');
    },
  );

  it('rechaza entradas cifradas, repetidas, métodos raros y demasiadas entradas', () => {
    expect(rejection(craftZip([{ name: 'a', data: 'x', flags: 1 }]))).toContain('cifrada');
    expect(
      rejection(
        craftZip([
          { name: 'a', data: 'x' },
          { name: 'a', data: 'y' },
        ]),
      ),
    ).toContain('repetida');
    const tooMany = craftZip(
      Array.from({ length: 11 }, (_, index) => ({ name: `f${index}`, data: 'x' })),
    );
    expect(rejection(tooMany)).toContain('demasiadas entradas');

    const weird = craftZip([{ name: 'a', data: 'x', method: 'store' }]);
    weird.writeUInt16LE(12, 8); // método 12 (bzip2) en la cabecera local…
    weird.writeUInt16LE(12, 30 + 1 + 1 + 10); // …y en la central
    expect(rejection(weird)).toContain('método de compresión 12');
  });

  it('rechaza lo que no es ZIP o está truncado', () => {
    expect(looksLikeZip(Buffer.from('Código;Sexo\n'))).toBe(false);
    expect(rejection(Buffer.from('PK\u0003\u0004 y nada más'))).toContain('final del directorio');
    const zip = craftZip([{ name: 'a.xml', data: 'hola' }]);
    expect(rejection(zip.subarray(0, 10))).toBeTruthy();
  });

  it('isSafeEntryName acepta los nombres normales de un xlsx', () => {
    for (const name of [
      '[Content_Types].xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
      'docProps/app.xml',
    ]) {
      expect(isSafeEntryName(name)).toBe(true);
    }
    expect(isSafeEntryName('')).toBe(false);
    expect(isSafeEntryName('a\0b')).toBe(false);
  });
});

describe('buildStoredZip', () => {
  it('se vuelve a leer igual, sin compresión', () => {
    const entries = [
      { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
      { name: 'xl/workbook.xml', data: Buffer.from('ñandú'.repeat(100)) },
    ];
    const zip = buildStoredZip(entries);
    expect(zip.includes(Buffer.from('ñandú'))).toBe(true);
    expect(readZipEntries(zip, SMALL)).toEqual(entries);
  });
});
