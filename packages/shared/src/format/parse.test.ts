import { describe, expect, it } from 'vitest';

import { toIsoDate } from '../date.js';
import {
  cellText,
  excelSerialToIsoDate,
  isEmptyCell,
  parseEsCoDate,
  parseEsCoDecimal,
  parseNonNegativeInteger,
  parseYesNo,
} from './parse.js';

const d = toIsoDate;

describe('cellText', () => {
  it('texto sin espacios sobrantes, números enteros sin notación, sí/no y fechas', () => {
    expect(cellText('  Canela   Roja ')).toBe('Canela Roja');
    expect(cellText(170000123456789)).toBe('170000123456789');
    expect(cellText(452.5)).toBe('452.5');
    expect(cellText(true)).toBe('Sí');
    expect(cellText(false)).toBe('No');
    expect(cellText({ date: d('2026-03-01') })).toBe('01/03/2026');
    expect(cellText(null)).toBe('');
    expect(cellText(undefined)).toBe('');
  });

  it('isEmptyCell', () => {
    expect(isEmptyCell(undefined)).toBe(true);
    expect(isEmptyCell(null)).toBe(true);
    expect(isEmptyCell('   ')).toBe(true);
    expect(isEmptyCell(0)).toBe(false);
    expect(isEmptyCell(false)).toBe(false);
  });
});

describe('excelSerialToIsoDate', () => {
  it('convierte las fechas seriales del sistema 1900', () => {
    expect(excelSerialToIsoDate(61)).toBe('1900-03-01');
    expect(excelSerialToIsoDate(45658)).toBe('2025-01-01');
    expect(excelSerialToIsoDate(46233)).toBe('2026-07-30');
    expect(excelSerialToIsoDate(46233.75)).toBe('2026-07-30');
  });

  it('rechaza lo que no es una fecha razonable', () => {
    expect(excelSerialToIsoDate(60)).toBeNull();
    expect(excelSerialToIsoDate(3_000_000)).toBeNull();
    expect(excelSerialToIsoDate(Number.NaN)).toBeNull();
  });
});

describe('parseEsCoDate', () => {
  it('acepta celdas de fecha, seriales, dd/mm/aaaa y aaaa-mm-dd', () => {
    expect(parseEsCoDate({ date: d('2024-02-29') })).toEqual({ ok: true, value: '2024-02-29' });
    expect(parseEsCoDate(45658)).toEqual({ ok: true, value: '2025-01-01' });
    expect(parseEsCoDate('15/03/2024')).toEqual({ ok: true, value: '2024-03-15' });
    expect(parseEsCoDate('5/3/2024')).toEqual({ ok: true, value: '2024-03-05' });
    expect(parseEsCoDate('05-03-2024')).toEqual({ ok: true, value: '2024-03-05' });
    expect(parseEsCoDate('05.03.2024')).toEqual({ ok: true, value: '2024-03-05' });
    expect(parseEsCoDate('2024-03-05')).toEqual({ ok: true, value: '2024-03-05' });
  });

  it('rechaza fechas inexistentes, ambiguas o con otro formato', () => {
    expect(parseEsCoDate('31/02/2024')).toMatchObject({
      ok: false,
      message: '«31/02/2024» no es una fecha que exista.',
    });
    expect(parseEsCoDate('01/02/26')).toMatchObject({ ok: false });
    expect(parseEsCoDate('marzo 2024')).toMatchObject({
      ok: false,
      message: expect.stringContaining('Usa el formato dd/mm/aaaa'),
    });
    expect(parseEsCoDate('2024-13-01')).toMatchObject({ ok: false });
    expect(parseEsCoDate(12)).toMatchObject({ ok: false, message: '«12» no es una fecha válida.' });
    expect(parseEsCoDate(true)).toMatchObject({ ok: false });
    expect(parseEsCoDate('')).toEqual({ ok: false, message: 'Escribe la fecha (dd/mm/aaaa).' });
  });
});

describe('parseEsCoDecimal', () => {
  it.each([
    ['452', 452],
    ['452,5', 452.5],
    ['1.234,5', 1234.5],
    ['1.234', 1234],
    ['452.5', 452.5],
    [' 31 ', 31],
    ['-3', -3],
  ])('«%s» → %d', (text, value) => {
    expect(parseEsCoDecimal(text)).toEqual({ ok: true, value });
  });

  it('acepta números de la hoja tal cual', () => {
    expect(parseEsCoDecimal(452.25)).toEqual({ ok: true, value: 452.25 });
    expect(parseEsCoDecimal(Number.POSITIVE_INFINITY)).toMatchObject({ ok: false });
  });

  it('rechaza letras, unidades y formatos mezclados', () => {
    for (const text of ['452 kg', 'cuatro', '1,234.5', '1.23.4', '12,3,4']) {
      expect(parseEsCoDecimal(text), text).toMatchObject({ ok: false });
    }
    expect(parseEsCoDecimal('452 kg')).toMatchObject({
      message: '«452 kg» no es un número. Escribe solo el número, sin letras ni unidades.',
    });
    expect(parseEsCoDecimal(null)).toEqual({ ok: false, message: 'Escribe el número.' });
  });
});

describe('parseNonNegativeInteger', () => {
  it('enteros desde cero', () => {
    expect(parseNonNegativeInteger('4')).toEqual({ ok: true, value: 4 });
    expect(parseNonNegativeInteger(0)).toEqual({ ok: true, value: 0 });
    expect(parseNonNegativeInteger('4,0')).toEqual({ ok: true, value: 4 });
  });

  it('rechaza decimales, negativos y texto', () => {
    expect(parseNonNegativeInteger('2,5')).toMatchObject({
      ok: false,
      message: '«2,5» debe ser un número entero, sin decimales.',
    });
    expect(parseNonNegativeInteger(-1)).toMatchObject({ ok: false });
    expect(parseNonNegativeInteger('dos')).toMatchObject({ ok: false });
  });
});

describe('parseYesNo', () => {
  it('Sí, No y variantes; vacía es No', () => {
    for (const value of ['Sí', 'si', 'SI', 'S', 'x', 'Verdadero', true]) {
      expect(parseYesNo(value), String(value)).toEqual({ ok: true, value: true });
    }
    for (const value of ['No', 'n', 'FALSO', false, null, '']) {
      expect(parseYesNo(value), String(value)).toEqual({ ok: true, value: false });
    }
  });

  it('rechaza lo demás', () => {
    expect(parseYesNo('tal vez')).toEqual({ ok: false, message: '«tal vez» no es Sí ni No.' });
  });
});
