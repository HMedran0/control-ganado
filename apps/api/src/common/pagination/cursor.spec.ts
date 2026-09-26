import { describe, expect, it } from 'vitest';
import { DomainError } from '@hato/shared';

import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  buildPage,
  decodeCursor,
  encodeCursor,
  parsePagination,
} from './cursor.js';

describe('cursor', () => {
  it('codifica y decodifica sin perder nada', () => {
    const payload = { id: '0195e0b0-1234-7000-8000-000000000000', code: '26-045' };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it('el cursor es opaco: no se lee a simple vista', () => {
    const cursor = encodeCursor({ id: 'abc' });
    expect(cursor).not.toContain('abc');
    expect(cursor).not.toContain('{');
  });

  it('rechaza un cursor corrupto con VALIDATION_FAILED', () => {
    for (const malo of ['no-es-base64!!', encodeCursor([] as never), 'eyJ9']) {
      expect(() => decodeCursor(malo)).toThrow(DomainError);
    }
    try {
      decodeCursor('basura');
    } catch (error) {
      expect((error as DomainError).code).toBe('VALIDATION_FAILED');
      expect((error as DomainError).fieldErrors?.cursor).toBeDefined();
    }
  });
});

describe('parsePagination', () => {
  it('sin parámetros usa el límite por defecto', () => {
    expect(parsePagination({})).toEqual({ limit: DEFAULT_LIMIT, cursor: null });
  });

  it('acepta el límite como texto o como número', () => {
    expect(parsePagination({ limit: '25' }).limit).toBe(25);
    expect(parsePagination({ limit: 25 }).limit).toBe(25);
  });

  it('acepta los extremos del límite', () => {
    expect(parsePagination({ limit: 1 }).limit).toBe(1);
    expect(parsePagination({ limit: MAX_LIMIT }).limit).toBe(MAX_LIMIT);
  });

  it('rechaza límites fuera de rango o no enteros', () => {
    for (const limit of [0, -1, MAX_LIMIT + 1, 1.5, 'muchos']) {
      expect(() => parsePagination({ limit: limit })).toThrow(DomainError);
    }
  });

  it('decodifica el cursor si viene', () => {
    const cursor = encodeCursor({ id: 'x' });
    expect(parsePagination({ cursor }).cursor).toEqual({ id: 'x' });
    expect(parsePagination({ cursor: '' }).cursor).toBeNull();
  });
});

describe('buildPage', () => {
  const rows = Array.from({ length: 4 }, (_value, index) => ({ id: `id-${index}` }));

  it('devuelve el cursor siguiente cuando hay más resultados', () => {
    // Se consultó limit + 1 = 4 para un límite de 3.
    const page = buildPage(rows, 3, (item) => ({ id: item.id }));

    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).not.toBeNull();
    expect(decodeCursor(page.nextCursor as string)).toEqual({ id: 'id-2' });
  });

  it('no devuelve cursor en la última página', () => {
    const page = buildPage(rows.slice(0, 2), 3, (item) => ({ id: item.id }));
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it('una página exacta no anuncia más resultados', () => {
    const page = buildPage(rows.slice(0, 3), 3, (item) => ({ id: item.id }));
    expect(page.nextCursor).toBeNull();
  });

  it('una lista vacía devuelve items vacíos y sin cursor', () => {
    expect(buildPage([], 3, () => ({ id: 'x' }))).toEqual({ items: [], nextCursor: null });
  });
});
