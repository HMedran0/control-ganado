import { describe, expect, it } from 'vitest';

import { assertSeedAllowed, isAllowedDatabaseUrl, resolveSeedToday, SEED_TODAY } from './guards.js';
import { createIdFactory } from './ids.js';
import { createRandom, distribute, REFERENCE_FARM_SEED } from './random.js';

/**
 * Determinismo de la base del seed. Si algo de esto falla, dos ejecuciones de `pnpm db:seed`
 * dejarían datos distintos y las cifras de `expected.ts` dejarían de poder afirmarse.
 */

describe('createRandom', () => {
  it('produce la misma secuencia con la misma semilla', () => {
    const first = createRandom(REFERENCE_FARM_SEED);
    const second = createRandom(REFERENCE_FARM_SEED);
    const take = (source: ReturnType<typeof createRandom>): number[] =>
      Array.from({ length: 50 }, () => source.next());

    expect(take(first)).toEqual(take(second));
  });

  it('produce secuencias distintas con semillas distintas', () => {
    const first = createRandom(1);
    const second = createRandom(2);
    expect(first.next()).not.toBe(second.next());
  });

  it('mantiene los enteros dentro del rango, extremos incluidos', () => {
    const random = createRandom(7);
    const values = Array.from({ length: 2000 }, () => random.int(1, 6));
    expect(Math.min(...values)).toBe(1);
    expect(Math.max(...values)).toBe(6);
  });

  it('baraja sin perder ni duplicar elementos', () => {
    const random = createRandom(11);
    const items = Array.from({ length: 30 }, (_, index) => index);
    const shuffled = random.shuffle(items);

    expect(shuffled).not.toEqual(items);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
  });

  it('respeta los pesos al elegir', () => {
    const random = createRandom(13);
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 1000; i += 1) counts[random.weighted(['a', 'b'] as const, [9, 1])] += 1;
    expect(counts.a).toBeGreaterThan(counts.b * 5);
  });
});

describe('distribute', () => {
  it('reparte el total exacto', () => {
    expect(distribute(284, [40, 30, 20, 10])).toEqual([114, 85, 57, 28]);
    expect(distribute(284, [40, 30, 20, 10]).reduce((a, b) => a + b, 0)).toBe(284);
  });

  it('no pierde unidades con restos difíciles', () => {
    for (const total of [1, 7, 97, 170, 5000]) {
      const parts = distribute(total, [1, 1, 1]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
});

describe('createIdFactory', () => {
  it('genera los mismos identificadores con la misma semilla', () => {
    const take = (): string[] => {
      const factory = createIdFactory(createRandom(REFERENCE_FARM_SEED));
      return Array.from({ length: 20 }, () => factory.next());
    };
    expect(take()).toEqual(take());
  });

  it('genera identificadores únicos y crecientes', () => {
    const factory = createIdFactory(createRandom(REFERENCE_FARM_SEED));
    const ids = Array.from({ length: 500 }, () => factory.next());

    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
    expect(ids.every((id) => id[14] === '7')).toBe(true);
  });
});

describe('guardas', () => {
  it('acepta las bases locales y la del servicio de integración continua', () => {
    expect(isAllowedDatabaseUrl('postgresql://hato:x@localhost:5432/hato')).toBe(true);
    expect(isAllowedDatabaseUrl('postgresql://hato:x@127.0.0.1:5433/hato')).toBe(true);
    expect(isAllowedDatabaseUrl('postgresql://hato:x@db:5432/hato')).toBe(true);
  });

  it('rechaza cualquier otra base', () => {
    expect(isAllowedDatabaseUrl('postgresql://hato:x@db.produccion.co:5432/hato')).toBe(false);
    expect(isAllowedDatabaseUrl('no-es-una-url')).toBe(false);
  });

  it('no se ejecuta en producción', () => {
    expect(() =>
      assertSeedAllowed({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://hato:x@localhost:5432/hato',
      }),
    ).toThrow(/producción/);
  });

  it('exige DATABASE_URL', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: 'development' })).toThrow(/DATABASE_URL/);
  });

  it('rechaza una base remota con el anfitrión en el mensaje', () => {
    expect(() =>
      assertSeedAllowed({ DATABASE_URL: 'postgresql://hato:x@10.0.0.9:5432/hato' }),
    ).toThrow(/10\.0\.0\.9/);
  });

  it('acepta que SEED_TODAY falte o coincida, y rechaza otra fecha', () => {
    expect(resolveSeedToday({})).toBe(SEED_TODAY);
    expect(resolveSeedToday({ SEED_TODAY: '2026-09-25' })).toBe(SEED_TODAY);
    expect(() => resolveSeedToday({ SEED_TODAY: '2026-09-26' })).toThrow(/2026-09-25/);
  });
});
