import { beforeEach, describe, expect, it } from 'vitest';

import { DomainError } from './errors.js';
import { isUuid, isUuidv7, resetUuidv7State, uuidv7, uuidv7Timestamp } from './id.js';

/** Aleatoriedad determinista para que las pruebas afirmen valores exactos. */
const fixedRandom = (length: number): Uint8Array =>
  Uint8Array.from({ length }, (_value, index) => index + 1);

beforeEach(() => {
  resetUuidv7State();
});

describe('uuidv7', () => {
  it('tiene la forma de un UUID, versión 7 y variante 10', () => {
    const id = uuidv7({ now: 1_774_000_000_000, random: fixedRandom });
    expect(isUuid(id)).toBe(true);
    expect(isUuidv7(id)).toBe(true);
    // El primer dígito del cuarto grupo codifica la variante: 8, 9, a o b.
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('codifica la marca de tiempo en los primeros 48 bits', () => {
    const now = 1_774_000_000_000;
    expect(uuidv7Timestamp(uuidv7({ now, random: fixedRandom }))).toBe(now);
  });

  it('crece dentro del mismo milisegundo gracias al contador', () => {
    const now = 1_774_000_000_000;
    const ids = Array.from({ length: 50 }, () => uuidv7({ now, random: fixedRandom }));
    expect(new Set(ids).size).toBe(50);
    expect([...ids].sort()).toEqual(ids);
  });

  it('ordena por tiempo entre milisegundos distintos', () => {
    const primero = uuidv7({ now: 1_774_000_000_000, random: fixedRandom });
    const segundo = uuidv7({ now: 1_774_000_000_001, random: fixedRandom });
    expect(segundo > primero).toBe(true);
  });

  it('no emite identificadores menores si el reloj retrocede', () => {
    const adelante = uuidv7({ now: 1_774_000_000_100, random: fixedRandom });
    const atrasado = uuidv7({ now: 1_774_000_000_000, random: fixedRandom });
    expect(atrasado > adelante).toBe(true);
  });

  it('avanza el milisegundo cuando se agota el contador de 12 bits', () => {
    const now = 1_774_000_000_000;
    const ids = Array.from({ length: 4098 }, () => uuidv7({ now, random: fixedRandom }));
    expect(new Set(ids).size).toBe(4098);
    expect([...ids].sort()).toEqual(ids);
    expect(uuidv7Timestamp(ids[4097] as string)).toBe(now + 1);
  });

  it('usa la aleatoriedad del entorno por defecto', () => {
    const ids = Array.from({ length: 20 }, () => uuidv7());
    expect(new Set(ids).size).toBe(20);
    expect(ids.every(isUuidv7)).toBe(true);
  });
});

describe('isUuid e isUuidv7', () => {
  it('rechaza lo que no es un UUID en minúsculas', () => {
    expect(isUuid('no-es-un-uuid')).toBe(false);
    expect(isUuid('0195E0B0-1234-7000-8000-000000000000')).toBe(false);
    expect(isUuid('')).toBe(false);
  });

  it('distingue la versión', () => {
    expect(isUuidv7('0195e0b0-1234-4000-8000-000000000000')).toBe(false);
    expect(isUuidv7('0195e0b0-1234-7000-8000-000000000000')).toBe(true);
  });
});

describe('uuidv7Timestamp', () => {
  it('lanza VALIDATION_FAILED si no es un UUIDv7', () => {
    expect(() => uuidv7Timestamp('0195e0b0-1234-4000-8000-000000000000')).toThrowError(DomainError);
  });
});
